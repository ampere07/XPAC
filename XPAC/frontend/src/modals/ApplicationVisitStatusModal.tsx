import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Camera, Loader2 } from 'lucide-react';
import { updateApplicationVisit, uploadApplicationVisitImages } from '../services/applicationVisitService';
import { updateApplication } from '../services/applicationService';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { locationDetailService, LocationDetail } from '../services/locationDetailService';
import { statusRemarksService, StatusRemark } from '../services/statusRemarksService';
import { userService } from '../services/userService';
import { planService, Plan } from '../services/planService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface Region {
  id: number;
  name: string;
}

interface ApplicationVisitStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedVisit: any) => void;
  visitData: {
    id: string;
    first_name: string;
    middle_initial?: string;
    last_name: string;
    visit_status?: string;
    visit_remarks?: string;
    status_remarks?: string;
    visit_notes?: string;
    assigned_email?: string;
    visit_by?: string;
    visit_with?: string;
    visit_with_other?: string;
    application_status?: string;
    [key: string]: any;
  };
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface StatusFormData {
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
  remarks: string;
  assignedEmail: string;
  modifiedBy: string;
}

interface TechnicianFormData {
  fullAddress: string;
  image1: File | null;
  image2: File | null;
  image3: File | null;
  visit_by: string;
  visit_with: string;
  visit_with_other: string;
  visitStatus: string;
  visitRemarks: string;
  statusRemarks: string;
}

const ApplicationVisitStatusModal: React.FC<ApplicationVisitStatusModalProps> = ({
  isOpen,
  onClose,
  onSave,
  visitData
}) => {
  const [userRole, setUserRole] = useState<string>('');
  const [pendingUpdate, setPendingUpdate] = useState<any>(null);
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

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  useEffect(() => {
    if (!isOpen) return;

    if (visitData) {
      const isValidImageUrl = (url: any): boolean => {
        if (!url) return false;
        if (typeof url !== 'string') return false;
        const trimmed = url.trim().toLowerCase();
        return trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined';
      };

      const newImagePreviews = {
        image1: convertGoogleDriveUrl(visitData?.image1_url || visitData?.image_1_url),
        image2: convertGoogleDriveUrl(visitData?.image2_url || visitData?.image_2_url),
        image3: convertGoogleDriveUrl(visitData?.image3_url || visitData?.image_3_url)
      };

      setImagePreviews(newImagePreviews);

      const errorsToClear: string[] = [];
      if (newImagePreviews.image1) errorsToClear.push('image1');
      if (newImagePreviews.image2) errorsToClear.push('image2');
      if (newImagePreviews.image3) errorsToClear.push('image3');

      if (errorsToClear.length > 0) {
        setErrors(prev => {
          const newErrors = { ...prev };
          errorsToClear.forEach(key => delete newErrors[key]);
          return newErrors;
        });
      }
    } else {
      setImagePreviews({
        image1: null,
        image2: null,
        image3: null
      });
    }
  }, [visitData, isOpen]);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const user = JSON.parse(authData);
        setUserRole(user.role?.toLowerCase() || '');
      } catch (error) {
        // Error parsing user data
      }
    }
  }, []);

  const [formData, setFormData] = useState<StatusFormData>(() => {
    return {
      firstName: visitData?.first_name || '',
      middleInitial: visitData?.middle_initial || '',
      lastName: visitData?.last_name || '',
      contactNumber: visitData?.contact_number || '',
      secondContactNumber: visitData?.second_contact_number || '',
      email: visitData?.email_address || '',
      address: visitData?.address || '',
      barangay: visitData?.barangay || '',
      city: visitData?.city || '',
      region: visitData?.region || '',
      location: visitData?.location || '',
      choosePlan: visitData?.choose_plan || 'SwitchConnect - P799',
      remarks: visitData?.visit_remarks || '',
      assignedEmail: visitData?.assigned_email || '',
      modifiedBy: 'current_user@ampere.com'
    };
  });

  const [technicianFormData, setTechnicianFormData] = useState<TechnicianFormData>({
    fullAddress: visitData?.address || '',
    image1: null,
    image2: null,
    image3: null,
    visit_by: visitData?.visit_by || '',
    visit_with: visitData?.visit_with || '',
    visit_with_other: visitData?.visit_with_other || 'None',
    visitStatus: visitData?.visit_status || '',
    visitRemarks: visitData?.visit_remarks || '',
    statusRemarks: visitData?.status_remarks || ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [statusRemarks, setStatusRemarks] = useState<StatusRemark[]>([]);
  const [technicians, setTechnicians] = useState<Array<{ email: string; name: string }>>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [imagePreviews, setImagePreviews] = useState<{
    image1: string | null;
    image2: string | null;
    image3: string | null;
  }>({
    image1: null,
    image2: null,
    image3: null
  });
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

  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  const [allLocations, setAllLocations] = useState<LocationDetail[]>([]);

  useEffect(() => {
    if (visitData) {
      setFormData(prev => ({
        ...prev,
        firstName: visitData.first_name || prev.firstName,
        middleInitial: visitData.middle_initial || prev.middleInitial,
        lastName: visitData.last_name || prev.lastName,
        contactNumber: visitData.contact_number || prev.contactNumber,
        secondContactNumber: visitData.second_contact_number || prev.secondContactNumber,
        email: visitData.email_address || prev.email,
        address: visitData.address || prev.address,
        barangay: visitData.barangay || prev.barangay,
        city: visitData.city || prev.city,
        region: visitData.region || prev.region,
        location: visitData.location || prev.location,
        choosePlan: visitData.choose_plan || prev.choosePlan,
        remarks: visitData.visit_remarks || prev.remarks,
        assignedEmail: visitData.assigned_email || prev.assignedEmail
      }));

      setTechnicianFormData(prev => ({
        ...prev,
        fullAddress: visitData.address || prev.fullAddress,
        image1: null,
        image2: null,
        image3: null,
        visit_by: visitData.visit_by || prev.visit_by,
        visit_with: visitData.visit_with || prev.visit_with,
        visit_with_other: visitData.visit_with_other || 'None',
        visitStatus: visitData.visit_status || prev.visitStatus,
        visitRemarks: visitData.visit_remarks || prev.visitRemarks,
        statusRemarks: visitData.status_remarks || prev.statusRemarks
      }));
    }
  }, [visitData]);

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
          setAllLocations([]);
        }
      }
    };

    fetchAllLocations();
  }, [isOpen]);

  useEffect(() => {
    const fetchStatusRemarks = async () => {
      if (isOpen) {
        try {
          const fetchedStatusRemarks = await statusRemarksService.getAllStatusRemarks();
          setStatusRemarks(fetchedStatusRemarks);
        } catch (error) {
          // Error fetching status remarks
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
          // Error fetching technicians
        }
      }
    };

    fetchTechnicians();
  }, [isOpen, visitData]);

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
          setPlans([]);
        }
      }
    };

    fetchPlans();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && visitData) {
      setFormData({
        firstName: visitData.first_name || '',
        middleInitial: visitData.middle_initial || '',
        lastName: visitData.last_name || '',
        contactNumber: visitData.contact_number || '',
        secondContactNumber: visitData.second_contact_number || '',
        email: visitData.email_address || '',
        address: visitData.address || '',
        barangay: visitData.barangay || '',
        city: visitData.city || '',
        region: visitData.region || '',
        location: visitData.location || '',
        choosePlan: visitData.choose_plan || 'SwitchConnect - P799',
        remarks: visitData.visit_remarks || '',
        assignedEmail: visitData.assigned_email || '',
        modifiedBy: 'current_user@ampere.com'
      });

      setTechnicianFormData({
        fullAddress: visitData.address || '',
        image1: null,
        image2: null,
        image3: null,
        visit_by: visitData.visit_by || '',
        visit_with: visitData.visit_with || '',
        visit_with_other: visitData.visit_with_other || 'None',
        visitStatus: visitData.visit_status || '',
        visitRemarks: visitData.visit_remarks || '',
        statusRemarks: visitData.status_remarks || ''
      });
    }
  }, [isOpen, visitData]);

  const handleInputChange = (field: keyof StatusFormData, value: string) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
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

  const handleTechnicianInputChange = (field: keyof TechnicianFormData, value: string | File | null) => {
    setTechnicianFormData(prev => ({ ...prev, [field]: value }));

    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleImageChange = async (field: 'image1' | 'image2' | 'image3', file: File) => {
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

      handleTechnicianInputChange(field, processedFile);

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
      handleTechnicianInputChange(field, file);

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

  useEffect(() => {
    if (!isOpen) {
      Object.values(imagePreviews).forEach(url => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    }
  }, [isOpen, imagePreviews]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (userRole === 'technician') {
      if (!technicianFormData.image1) {
        newErrors.image1 = 'Image is required';
      }
      if (!technicianFormData.visit_by.trim()) {
        newErrors.visit_by = 'Visit By is required';
      }
      if (!technicianFormData.visit_with.trim()) {
        newErrors.visit_with = 'Visit With is required';
      }
      if (!technicianFormData.visit_with_other.trim()) {
        newErrors.visit_with_other = 'Visit With (Other) is required';
      }
    } else {
      if (!formData.assignedEmail.trim()) {
        newErrors.assignedEmail = 'Assigned Email is required';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const mapFormDataToUpdateData = () => {
    if (userRole === 'technician') {
      const data: any = {
        visit_by: technicianFormData.visit_by,
        visit_with: technicianFormData.visit_with,
        visit_with_other: technicianFormData.visit_with_other,
        visit_status: technicianFormData.visitStatus,
        visit_remarks: technicianFormData.visitRemarks ? technicianFormData.visitRemarks.trim() : null,
        updated_by_user_id: null
      };

      if (technicianFormData.visitStatus === 'Not Ready' && technicianFormData.statusRemarks) {
        data.status_remarks = technicianFormData.statusRemarks;
      }

      return data;
    } else {
      return {
        assigned_email: formData.assignedEmail,
        visit_remarks: formData.remarks ? formData.remarks.trim() : null,
        region: formData.region,
        city: formData.city,
        barangay: formData.barangay,
        location: formData.location,
        choose_plan: formData.choosePlan,
        updated_by_user_id: null
      };
    }
  };

  const mapFormDataToApplicationUpdate = () => {
    const updateData: Record<string, any> = {
      first_name: formData.firstName,
      last_name: formData.lastName,
      mobile_number: formData.contactNumber,
      email_address: formData.email,
      installation_address: formData.address,
      region: formData.region,
      city: formData.city,
      barangay: formData.barangay
    };

    if (formData.middleInitial) {
      updateData.middle_initial = formData.middleInitial;
    }

    if (formData.secondContactNumber) {
      updateData.secondary_mobile_number = formData.secondContactNumber;
    }

    return updateData;
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

    if (!visitData?.id) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: 'Missing visit ID. Cannot update status.'
      });
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);
    setModal({
      isOpen: true,
      type: 'loading',
      title: 'Updating',
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
      if (!visitData?.application_id) {
        throw new Error('Missing application ID. Cannot update application data.');
      }

      const applicationUpdateData = mapFormDataToApplicationUpdate();

      try {
        await updateApplication(visitData.application_id.toString(), applicationUpdateData);
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

      const updateData = mapFormDataToUpdateData();

      const result = await updateApplicationVisit(visitData.id, updateData);

      if (!result.success) {
        throw new Error(result.message || 'Failed to update application visit');
      }

      if (userRole === 'technician' && (technicianFormData.image1 || technicianFormData.image2 || technicianFormData.image3)) {
        try {
          const uploadResult = await uploadApplicationVisitImages(
            visitData.id,
            visitData.first_name,
            visitData.middle_initial,
            visitData.last_name,
            {
              image1: technicianFormData.image1,
              image2: technicianFormData.image2,
              image3: technicianFormData.image3
            }
          );

          clearInterval(progressInterval);
          setLoadingPercentage(100);
          await new Promise(resolve => setTimeout(resolve, 500));

          if (uploadResult.success) {
            const updatedVisit = { ...visitData, ...updateData, ...applicationUpdateData };
            setPendingUpdate(updatedVisit);
            setModal({
              isOpen: true,
              type: 'success',
              title: 'Success',
              message: `Application and visit details updated, images uploaded successfully!\n\nCustomer: ${visitData.first_name} ${visitData.last_name}`,
              onConfirm: () => {
                setErrors({});
                onSave(pendingUpdate!);
                setPendingUpdate(null);
                onClose();
                setModal({ ...modal, isOpen: false });
              }
            });
          } else {
            setModal({
              isOpen: true,
              type: 'warning',
              title: 'Partial Success',
              message: `Visit details updated, but image upload failed: ${uploadResult.message}`
            });
          }
        } catch (uploadError: any) {
          clearInterval(progressInterval);
          const errorMsg = uploadError.response?.data?.message || uploadError.message || 'Unknown error';
          setModal({
            isOpen: true,
            type: 'warning',
            title: 'Partial Success',
            message: `Visit details updated, but image upload failed: ${errorMsg}`
          });
        }
      } else {
        clearInterval(progressInterval);
        setLoadingPercentage(100);
        await new Promise(resolve => setTimeout(resolve, 500));

        const updatedVisit = { ...visitData, ...updateData, ...applicationUpdateData };
        setPendingUpdate(updatedVisit);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: `Application and visit details updated successfully!\n\nCustomer: ${formData.firstName} ${formData.lastName}`,
          onConfirm: () => {
            setErrors({});
            onSave(pendingUpdate!);
            setPendingUpdate(null);
            onClose();
            setModal({ ...modal, isOpen: false });
          }
        });
      }
    } catch (error: any) {
      clearInterval(progressInterval);
      let errorMessage = 'Unknown error occurred';

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to Update',
        message: `Failed to update visit details: ${errorMessage}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  const getFullName = () => {
    return `${visitData.first_name || ''} ${visitData.middle_initial || ''} ${visitData.last_name || ''}`.trim();
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
          }`}>{label}{label === 'Image 1' && <span className="text-red-500">*</span>}</label>
        <div className={`relative w-full h-48 border rounded overflow-hidden cursor-pointer ${isDarkMode
          ? 'bg-gray-800 border-gray-700 hover:bg-gray-750'
          : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
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
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
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

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-gray-100 border-gray-300'
            }`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{getFullName()}</h2>
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
            {userRole === 'technician' ? (
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Full Address
                  </label>
                  <input
                    type="text"
                    value={technicianFormData.fullAddress}
                    readOnly
                    className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-400'
                      : 'bg-gray-100 border-gray-300 text-gray-500'
                      }`}
                  />
                </div>

                <ImagePreview
                  imageUrl={imagePreviews.image1}
                  label="Image 1"
                  onUpload={(file) => handleImageChange('image1', file)}
                  error={errors.image1}
                />

                {(technicianFormData.image1 || imagePreviews.image1) && (
                  <ImagePreview
                    imageUrl={imagePreviews.image2}
                    label="Image 2"
                    onUpload={(file) => handleImageChange('image2', file)}
                  />
                )}

                {(technicianFormData.image1 || imagePreviews.image1) && (technicianFormData.image2 || imagePreviews.image2) && (
                  <ImagePreview
                    imageUrl={imagePreviews.image3}
                    label="Image 3"
                    onUpload={(file) => handleImageChange('image3', file)}
                  />
                )}

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Visit By<span className="text-red-500">*</span>
                  </label>
                  <select
                    value={technicianFormData.visit_by}
                    onChange={(e) => handleTechnicianInputChange('visit_by', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.visit_by ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}
                  >
                    <option value="">Select Visit By</option>
                    {technicians.filter(t => t.name !== technicianFormData.visit_with && t.name !== technicianFormData.visit_with_other).map((technician, index) => (
                      <option key={index} value={technician.name}>{technician.name}</option>
                    ))}
                  </select>
                  {errors.visit_by && <p className="text-red-500 text-xs mt-1 flex items-center"><span className="mr-1">⚠</span>{errors.visit_by}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Visit With<span className="text-red-500">*</span>
                  </label>
                  <select
                    value={technicianFormData.visit_with}
                    onChange={(e) => handleTechnicianInputChange('visit_with', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.visit_with ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}
                  >
                    <option value="">Select Visit With</option>
                    <option value="None">None</option>
                    {technicians.filter(t => t.name !== technicianFormData.visit_by && t.name !== technicianFormData.visit_with_other).map((technician, index) => (
                      <option key={index} value={technician.name}>{technician.name}</option>
                    ))}
                  </select>
                  {errors.visit_with && <p className="text-red-500 text-xs mt-1 flex items-center"><span className="mr-1">⚠</span>{errors.visit_with}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Visit With(Other)<span className="text-red-500">*</span>
                  </label>
                  <select
                    value={technicianFormData.visit_with_other}
                    onChange={(e) => handleTechnicianInputChange('visit_with_other', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.visit_with_other ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}
                  >
                    <option value="">Select Visit With(Other)</option>
                    <option value="None">None</option>
                    {technicians.filter(t => t.name !== technicianFormData.visit_by && t.name !== technicianFormData.visit_with).map((technician, index) => (
                      <option key={index} value={technician.name}>{technician.name}</option>
                    ))}
                  </select>
                  {errors.visit_with_other && <p className="text-red-500 text-xs mt-1 flex items-center"><span className="mr-1">⚠</span>{errors.visit_with_other}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Visit Status
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleTechnicianInputChange('visitStatus', 'In Progress')}
                      className={`flex-1 px-4 py-3 rounded text-sm font-medium transition-colors ${technicianFormData.visitStatus === 'In Progress'
                        ? 'bg-orange-600 text-white'
                        : isDarkMode
                          ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                      In Progress
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTechnicianInputChange('visitStatus', 'OK to Install')}
                      className={`flex-1 px-4 py-3 rounded text-sm font-medium transition-colors ${technicianFormData.visitStatus === 'OK to Install'
                        ? 'bg-orange-600 text-white'
                        : isDarkMode
                          ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                      OK to Install
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTechnicianInputChange('visitStatus', 'Not Ready')}
                      className={`flex-1 px-4 py-3 rounded text-sm font-medium transition-colors ${technicianFormData.visitStatus === 'Not Ready'
                        ? 'bg-orange-600 text-white'
                        : isDarkMode
                          ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                    >
                      Not Ready
                    </button>
                  </div>
                </div>

                {technicianFormData.visitStatus === 'Not Ready' && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                      Status Remarks
                    </label>
                    <select
                      value={technicianFormData.statusRemarks}
                      onChange={(e) => handleTechnicianInputChange('statusRemarks', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    >
                      <option value="">Select Status Remarks</option>
                      {technicianFormData.statusRemarks && !statusRemarks.some(sr => sr.status_remarks === technicianFormData.statusRemarks) && (
                        <option value={technicianFormData.statusRemarks}>{technicianFormData.statusRemarks}</option>
                      )}
                      {statusRemarks.map((remark, index) => (
                        <option key={index} value={remark.status_remarks}>{remark.status_remarks}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Visit Remarks
                  </label>
                  <textarea
                    value={technicianFormData.visitRemarks}
                    onChange={(e) => handleTechnicianInputChange('visitRemarks', e.target.value)}
                    rows={4}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                    placeholder="Enter visit remarks..."
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    First Name
                  </label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => handleInputChange('firstName', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
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
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => handleInputChange('lastName', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Contact Number
                  </label>
                  <input
                    type="text"
                    value={formData.contactNumber}
                    onChange={(e) => handleInputChange('contactNumber', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
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
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Applicant Email Address
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Address
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Region
                  </label>
                  <div className="relative">
                    <select
                      value={formData.region}
                      onChange={(e) => handleInputChange('region', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
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
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    City
                  </label>
                  <div className="relative">
                    <select
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                      disabled={!formData.region}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
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
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Barangay
                  </label>
                  <div className="relative">
                    <select
                      value={formData.barangay}
                      onChange={(e) => handleInputChange('barangay', e.target.value)}
                      disabled={!formData.city}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
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
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Location
                  </label>
                  <div className="relative">
                    <select
                      value={formData.location}
                      onChange={(e) => handleInputChange('location', e.target.value)}
                      disabled={!formData.barangay}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    >
                      <option value="">{formData.barangay ? 'Select Location' : 'Select Barangay First'}</option>
                      {formData.location && !filteredLocations.some(loc => loc.location_name === formData.location) && (
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
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Choose Plan
                  </label>
                  <div className="relative">
                    <select
                      value={formData.choosePlan}
                      onChange={(e) => handleInputChange('choosePlan', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
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
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode
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
                  <div className="relative">
                    <select
                      value={formData.assignedEmail}
                      onChange={(e) => handleInputChange('assignedEmail', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${errors.assignedEmail ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
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
                    <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
                  </div>
                  {errors.assignedEmail && <p className="text-red-500 text-xs mt-1">{errors.assignedEmail}</p>}
                </div>
              </div>
            )}
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
    </>
  );
};

export default ApplicationVisitStatusModal;
