import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Loader2 } from 'lucide-react';
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
  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
        }`}>
        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-300'
          }`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Application Form Visit</h2>
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
                }`}>
                First Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.firstName}
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
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              />
              {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Middle Initial
              </label>
              <input
                type="text"
                value={formData.middleInitial}
                onChange={(e) => handleInputChange('middleInitial', e.target.value)}
                maxLength={1}
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
                className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
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
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
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
                onFocus={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.borderColor = colorPalette.primary;
                    e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                  }
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = errors.contactNumber ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                  e.currentTarget.style.boxShadow = 'none';
                }}
                className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.contactNumber ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              />
              {errors.contactNumber && <p className="text-red-500 text-xs mt-1">{errors.contactNumber}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Second Contact Number
              </label>
              <input
                type="text"
                value={formData.secondContactNumber || ''}
                onChange={(e) => handleInputChange('secondContactNumber', e.target.value)}
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
                className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
              />
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
                onFocus={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.borderColor = colorPalette.primary;
                    e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                  }
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = errors.email ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                  e.currentTarget.style.boxShadow = 'none';
                }}
                className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors ${errors.email ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Address<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.address}
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
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              />
              {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Region<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.region}
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
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                >
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
                }`}>
                City<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.city}
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
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
              {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Barangay<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.barangay}
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
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
              {errors.barangay && <p className="text-red-500 text-xs mt-1">{errors.barangay}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Location<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.location}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  disabled={!formData.barangay}
                  onFocus={(e) => {
                    if (colorPalette?.primary && !e.currentTarget.disabled) {
                      e.currentTarget.style.borderColor = colorPalette.primary;
                      e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                    }
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = errors.location ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${errors.location ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                >
                  <option value="">{formData.barangay ? 'Select Location' : 'Select Barangay First'}</option>
                  {formData.location && formData.location.trim() !== '' && !filteredLocations.some(loc => loc.location_name === formData.location) && (
                    <option value={formData.location}>{formData.location}</option>
                  )}
                  {filteredLocations.map((location) => (
                    <option key={location.id} value={location.location_name}>
                      {location.location_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
              {errors.location && <p className="text-red-500 text-xs mt-1">{errors.location}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Choose Plan<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.choosePlan}
                  onChange={(e) => handleInputChange('choosePlan', e.target.value)}
                  onFocus={(e) => {
                    if (colorPalette?.primary) {
                      e.currentTarget.style.borderColor = colorPalette.primary;
                      e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                    }
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = errors.choosePlan ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${errors.choosePlan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
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
                      <option key={plan.id} value={planWithPrice}>
                        {planWithPrice}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
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
                  className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
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
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Remarks
              </label>
              <textarea
                value={formData.remarks}
                onChange={(e) => handleInputChange('remarks', e.target.value)}
                rows={3}
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
                className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors resize-none ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Assigned Email<span className="text-red-500">*</span>
              </label>
              <select
                value={formData.assignedEmail}
                onChange={(e) => handleInputChange('assignedEmail', e.target.value)}
                onFocus={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.borderColor = colorPalette.primary;
                    e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                  }
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = errors.assignedEmail ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db');
                  e.currentTarget.style.boxShadow = 'none';
                }}
                className={`w-full px-3 py-2 border rounded focus:outline-none transition-colors appearance-none ${errors.assignedEmail ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              >
                <option value="">Select Assigned Email</option>
                {formData.assignedEmail && !technicians.some(t => t.email === formData.assignedEmail) && (
                  <option value={formData.assignedEmail}>{formData.assignedEmail}</option>
                )}
                {technicians.map((technician, index) => (
                  <option key={index} value={technician.email}>{technician.email}</option>
                ))}
              </select>
              {errors.assignedEmail && <p className="text-red-500 text-xs mt-1">{errors.assignedEmail}</p>}
            </div>

            <input type="hidden" value={formData.visit_by || formData.assignedEmail} />
            <input type="hidden" value={formData.visitType} />
            <input type="hidden" value={formData.status} />
          </div>
        </div>
      </div>

      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode
            ? 'bg-gray-900 border-gray-700'
            : 'bg-white border-gray-300'
            }`}>
            {modal.type === 'loading' ? (
              <div className="text-center">
                <div className="flex justify-center mb-6">
                  <div className="animate-spin rounded-full h-20 w-20 border-b-4 border-orange-500"></div>
                </div>
                <p className="text-white text-4xl font-bold">{loadingPercentage}%</p>
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
    </div>
  );
};

export default ApplicationVisitFormModal;
