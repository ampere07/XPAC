import React, { useState, useEffect } from 'react';
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
import { ChevronLeft } from 'lucide-react-native';
import { SearchablePicker, SearchablePickerTrigger } from '../components/SearchablePicker';
import { createApplicationVisit, ApplicationVisitData } from '../services/applicationVisitService';
import { updateApplication } from '../services/applicationService';
import { UserData } from '../types/api';
import { userService } from '../services/userService';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { locationDetailService, LocationDetail } from '../services/locationDetailService';
import { planService, Plan } from '../services/planService';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ApplicationVisitFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: ApplicationVisitData) => void;
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

interface VisitFormData {
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
  choosePlan: string;
  promo: string;
  remarks: string;
  assignedEmail: string;
  visit_by: string;
  visit_with: string;
  visit_with_other: string;
  visitType: string;
  visitNotes: string;
  status: string;
  createdBy: string;
  modifiedBy: string;
}

const ApplicationVisitFormModal: React.FC<ApplicationVisitFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  applicationData
}) => {
  // Auth lives in AsyncStorage on RN, so the user is loaded after mount rather than
  // read synchronously during render the way the web build did.
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const currentUserEmail = currentUser?.email || 'unknown@email.com';

  useEffect(() => {
    AsyncStorage.getItem('authData')
      .then((authData) => {
        if (authData) setCurrentUser(JSON.parse(authData));
      })
      .catch((error) => console.error('Error getting current user:', error));
  }, []);

  useEffect(() => {
    if (isOpen && applicationData) {
      setFormData(prev => ({
        ...prev,
        firstName: applicationData.first_name || prev.firstName,
        middleInitial: applicationData.middle_initial || prev.middleInitial,
        lastName: applicationData.last_name || prev.lastName,
        contactNumber: applicationData.mobile_number || prev.contactNumber,
        secondContactNumber: applicationData.secondary_mobile_number || prev.secondContactNumber,
        email: applicationData.email_address || prev.email,
        address: applicationData.installation_address || prev.address,
        barangay: applicationData.barangay || prev.barangay,
        city: applicationData.city || prev.city,
        region: applicationData.region || prev.region,
        location: applicationData.location || prev.location,
        choosePlan: applicationData.desired_plan || prev.choosePlan,
        promo: applicationData.promo || prev.promo
      }));
    }
  }, [isOpen, applicationData]);


  const [formData, setFormData] = useState<VisitFormData>(() => {
    const initialSecondContact = applicationData?.secondary_mobile_number || '';

    return {
      firstName: applicationData?.first_name || '',
      middleInitial: applicationData?.middle_initial || '',
      lastName: applicationData?.last_name || '',
      contactNumber: applicationData?.mobile_number || '',
      secondContactNumber: initialSecondContact,
      email: applicationData?.email_address || '',
      address: applicationData?.installation_address || '',
      barangay: applicationData?.barangay || '',
      city: applicationData?.city || '',
      region: applicationData?.region || '',
      location: applicationData?.location || '',
      choosePlan: applicationData?.desired_plan || 'SwitchConnect - P799',
      promo: applicationData?.promo || '',
      remarks: '',
      assignedEmail: '',
      visit_by: '',
      visit_with: 'None',
      visit_with_other: '',
      visitType: 'Initial Visit',
      visitNotes: '',
      status: 'Scheduled',
      createdBy: currentUserEmail,
      modifiedBy: currentUserEmail
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  // Which dropdown is open, and the term typed into its search box.
  const [activePicker, setActivePicker] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState<string>('');
  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  // RN has no document/MutationObserver — read the stored theme once on mount.
  useEffect(() => {
    AsyncStorage.getItem('theme')
      .then((theme) => setIsDarkMode(theme === 'dark'))
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

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  interface Region {
    id: number;
    name: string;
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

  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  const [allLocations, setAllLocations] = useState<LocationDetail[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);

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
          console.error('Error loading promos:', error);
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



  const handleInputChange = (field: keyof VisitFormData, value: string) => {
    setFormData(prev => {
      const newFormData = { ...prev, [field]: value };

      if (field === 'assignedEmail') {
        newFormData.visit_by = value;
      }

      if (field === 'region') {
        newFormData.city = '';
        newFormData.barangay = '';
        newFormData.location = '';
      } else if (field === 'city') {
        newFormData.barangay = '';
        newFormData.location = '';
      } else if (field === 'barangay') {
        newFormData.location = '';
      }

      return newFormData;
    });

    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
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

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.assignedEmail.trim()) {
      newErrors.assignedEmail = 'Assigned Email is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const mapFormDataToVisitData = (applicationId: string): ApplicationVisitData => {
    const appId = parseInt(applicationId);

    if (isNaN(appId) || appId <= 0) {
      throw new Error(`Invalid application ID: ${applicationId}`);
    }

    return {
      application_id: appId,
      assigned_email: formData.assignedEmail,
      visit_by: formData.assignedEmail,
      visit_with: formData.visit_with !== 'Other' && formData.visit_with !== 'None' ? formData.visit_with : (formData.visit_with === 'Other' ? formData.visit_with_other : null),
      visit_status: formData.status,
      visit_remarks: formData.remarks || formData.visitNotes || null,
      application_status: 'Scheduled',
      region: formData.region,
      city: formData.city,
      barangay: formData.barangay,
      location: formData.location,
      choose_plan: formData.choosePlan,
      promo: formData.promo || null,
      house_front_picture_url: applicationData?.house_front_picture_url || null,
      created_by_user_email: currentUserEmail,
      updated_by_user_email: currentUserEmail
    };
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

    if (!applicationData?.id) {
      console.error('No application ID available');
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: 'Missing application ID. Cannot save visit.'
      });
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);
    setModal({
      isOpen: true,
      type: 'loading',
      title: 'Submitting',
      message: 'Please wait while we process your request...'
    });

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 0.5;
        if (prev >= 70) return prev + 1;
        return prev + 3;
      });
    }, 200);

    try {
      const applicationId = applicationData.id;

      const applicationUpdateData: any = {
        first_name: formData.firstName,
        middle_initial: formData.middleInitial || null,
        last_name: formData.lastName,
        mobile_number: formData.contactNumber,
        secondary_mobile_number: formData.secondContactNumber || null,
        email_address: formData.email,
        installation_address: formData.address,
        region: formData.region,
        city: formData.city,
        barangay: formData.barangay,
        location: formData.location,
        desired_plan: formData.choosePlan,
        promo: formData.promo || null
      };

      try {
        await updateApplication(applicationId.toString(), applicationUpdateData);
      } catch (appError: any) {
        console.error('Error updating application:', appError);

        clearInterval(progressInterval);
        const errorMsg = appError.response?.data?.message || appError.message || 'Unknown error';
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: `Failed to update application data!\n\nError: ${errorMsg}\n\nPlease try again.`
        });
        setLoading(false);
        return;
      }

      const visitData = mapFormDataToVisitData(applicationId);

      const result = await createApplicationVisit(visitData);

      if (!result.success) {
        throw new Error(result.message || 'Failed to create application visit');
      }

      clearInterval(progressInterval);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Visit created successfully!\n\nApplication data has been updated with the new location and plan information.',
        onConfirm: () => {
          setErrors({});
          onSave(visitData);
          onClose();
          setModal({ ...modal, isOpen: false });
        }
      });
    } catch (error: any) {
      console.error('Error creating application visit:', error);

      clearInterval(progressInterval);
      let errorMessage = 'Unknown error occurred';
      let errorDetails = '';

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error.response?.data) {
        const responseData = error.response.data;
        errorMessage = responseData.message || 'Server error occurred';

        if (responseData.errors) {
          errorDetails = Object.entries(responseData.errors)
            .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
            .join('\n');
        } else if (responseData.error) {
          errorDetails = responseData.error;
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      const fullErrorMessage = errorDetails
        ? `${errorMessage}\n\nDetails:\n${errorDetails}`
        : errorMessage;

      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to Schedule Visit',
        message: fullErrorMessage
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  if (!isOpen) return null;

  const activeColor = colorPalette?.primary || '#7c3aed';

  const pickerOptions: Record<string, { title: string; options: { label: string; value: string }[] }> = {
    region: {
      title: 'Select Region',
      options: regions.map((r) => ({ label: r.name, value: r.name })),
    },
    city: {
      title: 'Select City',
      options: filteredCities.map((c) => ({ label: c.name, value: c.name })),
    },
    barangay: {
      title: 'Select Barangay',
      options: filteredBarangays.map((b) => ({ label: b.barangay, value: b.barangay })),
    },
    location: {
      title: 'Select Location',
      options: filteredLocations.map((l) => ({ label: l.location_name, value: l.location_name })),
    },
    choosePlan: {
      title: 'Select Plan',
      options: plans.map((plan) => {
        const planWithPrice = plan.price ? `${plan.name} - P${plan.price}` : plan.name;
        return { label: planWithPrice, value: planWithPrice };
      }),
    },
    promo: {
      title: 'Select Promo',
      options: [{ label: 'None', value: 'None' }].concat(
        promos.map((p) => ({
          label: p.description ? `${p.promo_name} - ${p.description}` : p.promo_name,
          value: p.promo_name,
        }))
      ),
    },
    assignedEmail: {
      title: 'Select Assigned Email',
      options: technicians.map((t) => ({ label: t.email, value: t.email })),
    },
  };

  // A value already on the record that is no longer in the lookup list still needs to be
  // selectable — mirrors the extra <option> the web form injects for stale values.
  const optionsFor = (field: string) => {
    const config = pickerOptions[field];
    if (!config) return [];
    const current = (formData as any)[field];
    const options = current && !config.options.some((o) => o.value === current)
      ? [{ label: String(current), value: String(current) }, ...config.options]
      : config.options;
    const term = pickerSearch.trim().toLowerCase();
    return term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options;
  };

  const renderInput = (
    field: keyof VisitFormData,
    label: string,
    required: boolean = false,
    options: { multiline?: boolean; maxLength?: number; keyboardType?: any } = {}
  ) => (
    <View style={vf.fieldGroup} key={String(field)}>
      <Text style={[vf.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
        {label}{required && <Text style={vf.required}>*</Text>}
      </Text>
      <TextInput
        value={String((formData as any)[field] ?? '')}
        onChangeText={(text) => handleInputChange(field, text)}
        multiline={options.multiline}
        maxLength={options.maxLength}
        keyboardType={options.keyboardType}
        textAlignVertical={options.multiline ? 'top' : 'center'}
        placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
        style={[vf.input, {
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderColor: errors[field as string] ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
          color: isDarkMode ? '#ffffff' : '#111827',
          minHeight: options.multiline ? 84 : 44,
        }]}
      />
      {errors[field as string] ? <Text style={vf.errorText}>{errors[field as string]}</Text> : null}
    </View>
  );

  const renderSelect = (
    field: string,
    label: string,
    required: boolean = false,
    disabledReason?: string
  ) => (
    <SearchablePickerTrigger
      key={field}
      label={label}
      value={String((formData as any)[field] || '')}
      onPress={() => {
        if (disabledReason) return;
        setPickerSearch('');
        setActivePicker(field);
      }}
      error={errors[field]}
      isDarkMode={isDarkMode}
      placeholder={disabledReason || pickerOptions[field]?.title || 'Select...'}
      required={required}
    />
  );

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={handleCancel}>
      <View style={[vf.container, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }]}>
        <View style={[vf.header, {
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb'
        }]}>
          <Pressable onPress={handleCancel} disabled={loading} style={vf.headerBack}>
            <ChevronLeft size={26} color={activeColor} />
          </Pressable>
          <Text style={[vf.headerTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]} numberOfLines={1}>
            Application Form Visit
          </Text>
          <Pressable
            onPress={handleSave}
            disabled={loading}
            style={[vf.saveBtn, { backgroundColor: loading ? '#9ca3af' : activeColor }]}
          >
            {loading
              ? <ActivityIndicator size="small" color="#ffffff" />
              : <Text style={vf.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={vf.body}
            keyboardShouldPersistTaps="handled"
          >
            {renderInput('firstName', 'First Name', true)}
            {renderInput('middleInitial', 'Middle Initial', false, { maxLength: 1 })}
            {renderInput('lastName', 'Last Name', true)}
            {renderInput('contactNumber', 'Contact Number', true, { keyboardType: 'phone-pad' })}
            {renderInput('secondContactNumber', 'Second Contact Number', false, { keyboardType: 'phone-pad' })}
            {renderInput('email', 'Applicant Email Address', true, { keyboardType: 'email-address' })}
            {renderInput('address', 'Address', true)}

            {renderSelect('region', 'Region', true)}
            {renderSelect('city', 'City', true, !formData.region ? 'Select Region First' : undefined)}
            {renderSelect('barangay', 'Barangay', true, !formData.city ? 'Select City First' : undefined)}
            {renderSelect('location', 'Location', true, !formData.barangay ? 'Select Barangay First' : undefined)}
            {renderSelect('choosePlan', 'Choose Plan', true)}
            {renderSelect('promo', 'Promo')}

            {renderInput('remarks', 'Remarks', false, { multiline: true })}

            {renderSelect('assignedEmail', 'Assigned Email', true)}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <SearchablePicker
        isOpen={!!activePicker}
        onClose={() => setActivePicker(null)}
        title={activePicker ? (pickerOptions[activePicker]?.title || 'Select') : 'Select'}
        data={activePicker ? optionsFor(activePicker) : []}
        onSelect={(item: any) => {
          if (activePicker) handleInputChange(activePicker as keyof VisitFormData, item.value);
          setActivePicker(null);
        }}
        keyExtractor={(item: any, index: number) => `${item.value}-${index}`}
        searchValue={pickerSearch}
        onSearchChange={setPickerSearch}
        isDarkMode={isDarkMode}
        activeColor={activeColor}
        selectedItemValue={activePicker ? (formData as any)[activePicker] : undefined}
      />

      {/* Status / progress dialog */}
      <Modal visible={modal.isOpen} transparent animationType="fade" statusBarTranslucent>
        <View style={vf.statusOverlay}>
          <View style={[vf.statusCard, {
            backgroundColor: isDarkMode ? '#111827' : '#ffffff',
            borderColor: isDarkMode ? '#374151' : '#d1d5db'
          }]}>
            {modal.type === 'loading' ? (
              <View style={{ alignItems: 'center', gap: 16 }}>
                <ActivityIndicator size="large" color={activeColor} />
                <Text style={[vf.statusPercent, { color: isDarkMode ? '#ffffff' : '#111827' }]}>
                  {Math.round(loadingPercentage)}%
                </Text>
              </View>
            ) : (
              <>
                <Text style={[vf.statusTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>{modal.title}</Text>
                <Text style={[vf.statusMessage, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>{modal.message}</Text>
                <View style={vf.statusActions}>
                  {modal.type === 'confirm' ? (
                    <>
                      <Pressable
                        onPress={modal.onCancel}
                        style={[vf.statusCancelBtn, { borderColor: isDarkMode ? '#4b5563' : '#d1d5db' }]}
                      >
                        <Text style={{ color: isDarkMode ? '#d1d5db' : '#374151', fontWeight: '500' }}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={modal.onConfirm} style={[vf.statusOkBtn, { backgroundColor: activeColor }]}>
                        <Text style={vf.statusOkText}>Confirm</Text>
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
                      style={[vf.statusOkBtn, { backgroundColor: activeColor }]}
                    >
                      <Text style={vf.statusOkText}>OK</Text>
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

const vf = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 48,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerBack: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600' },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, minWidth: 72, alignItems: 'center' },
  saveBtnText: { color: '#ffffff', fontWeight: '600' },
  body: { padding: 16, paddingBottom: 80, gap: 4 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  required: { color: '#ef4444' },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
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

export default ApplicationVisitFormModal;