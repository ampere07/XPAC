import React, { useState, useEffect, useRef } from 'react';
import { X, Camera, MapPin, ChevronDown, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { getRegions, getCities, City } from '../services/cityService';
import { barangayService, Barangay } from '../services/barangayService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createBasemap, PH_BOUNDS, selectedPinIcon, isDarkThemeActive } from '../config/osmMap';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';

interface EditData {
  id: number;
  lcpnap_name: string;
  lcp_name: string;
  nap_name: string;
  street?: string;
  barangay?: string;
  city?: string;
  region?: string;
  port_total?: number;
  coordinates?: string;
  modified_by?: string;
  reading_image_url?: string;
  image1_url?: string;
  image2_url?: string;
}

interface AddLcpNapLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editData?: EditData;
  /**
   * Coordinates to open with, as the stored "lat, lng" string. Supplied by the map's
   * pin-drop flow, which has already had the operator place and confirm the point.
   */
  initialCoordinates?: string;
  /**
   * Present the coordinates as settled: read-only field, no click-to-set map, and no
   * geolocation guess. The pin the operator confirmed on the map is the answer, and
   * nothing in here may quietly move it.
   */
  lockCoordinates?: boolean;
}

interface LCP {
  id: number;
  lcp_name: string;
}

interface NAP {
  id: number;
  nap_name: string;
}

interface Region {
  id: number;
  name: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

const getDriveDirectUrl = (url: string | undefined): string => {
  if (!url) return '';
  if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
    const matchD = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (matchD && matchD[1]) return `https://drive.google.com/thumbnail?id=${matchD[1]}&sz=w1000`;
    const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchId && matchId[1]) return `https://drive.google.com/thumbnail?id=${matchId[1]}&sz=w1000`;
  }
  return url;
};

const AddLcpNapLocationModal: React.FC<AddLcpNapLocationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editData,
  initialCoordinates,
  lockCoordinates = false,
}) => {
  const getCurrentUser = () => {
    try {
      const authData = localStorage.getItem('authData');
      if (authData) {
        const user = JSON.parse(authData);
        return user.email || '';
      }
    } catch (error) {
      console.error('Error getting current user:', error);
    }
    return '';
  };

  const currentUserEmail = getCurrentUser();

  const [formData, setFormData] = useState({
    reading_image: null as File | null,
    street: '',
    barangay: '',
    city: '',
    region: '',
    lcp_name: '',
    nap_name: '',
    port_total: '',
    lcpnap_name: '',
    coordinates: '',
    image: null as File | null,
    image_2: null as File | null,
    modified_by: currentUserEmail,
  });

  const [imagePreviews, setImagePreviews] = useState({
    reading_image: null as string | null,
    image: null as string | null,
    image_2: null as string | null,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [showResultModal, setShowResultModal] = useState(false);
  const [resultType, setResultType] = useState<'success' | 'error'>('success');
  const [resultMessage, setResultMessage] = useState('');
  const [existingImageUrls, setExistingImageUrls] = useState({
    reading_image: null as string | null,
    image: null as string | null,
    image_2: null as string | null,
  });
  const [lcpList, setLcpList] = useState<LCP[]>([]);
  const [napList, setNapList] = useState<NAP[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Barangay[]>([]);
  const [showCoordinatesMap, setShowCoordinatesMap] = useState<boolean>(false);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

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
    if (isOpen) {
      loadDropdownData();
      fetchImageSizeSettings();
      if (editData) {
        populateForm(editData);
      } else {
        resetForm();
        // A pin-drop hands the coordinates in already confirmed. Applied after the reset
        // so the blank form does not wipe them.
        if (initialCoordinates) {
          setFormData(prev => ({ ...prev, coordinates: initialCoordinates }));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialCoordinates]);

  const fetchImageSizeSettings = async () => {
    try {
      const settings = await getActiveImageSize();
      setActiveImageSize(settings);
    } catch (error) {
      setActiveImageSize(null);
    }
  };

  useEffect(() => {
    if (!showCoordinatesMap) {
      cleanupMap();
      return;
    }
    if (mapInstanceRef.current) return;

    // The container is rendered by this same state change, so it does not exist
    // yet on this tick. Waiting a frame is what the asynchronous script load
    // used to do by accident.
    const raf = requestAnimationFrame(() => initializeMap());

    return () => {
      cancelAnimationFrame(raf);
      cleanupMap();
    };
  }, [showCoordinatesMap]);

  useEffect(() => {
    if (formData.lcp_name && formData.nap_name) {
      const generatedName = `${formData.lcp_name} ${formData.nap_name}`;
      setFormData(prev => ({ ...prev, lcpnap_name: generatedName }));
    } else {
      setFormData(prev => ({ ...prev, lcpnap_name: '' }));
    }
  }, [formData.lcp_name, formData.nap_name]);

  const initializeMap = () => {
    if (!mapRef.current || mapInstanceRef.current) return;

    try {
      const defaultLat = 14.5995;
      const defaultLng = 120.9842;

      const map = L.map(mapRef.current, {
        center: [defaultLat, defaultLng],
        zoom: 6,
        minZoom: 6,
        maxBounds: PH_BOUNDS,
        maxBoundsViscosity: 1.0,
        zoomControl: true,
      });

      createBasemap(isDarkThemeActive()).addTo(map);

      // Locked coordinates came from a confirmed pin drop — the preview map stays a
      // preview and cannot re-set them.
      if (!lockCoordinates) {
        map.on('click', (e: L.LeafletMouseEvent) => {
          handleMapClick(e.latlng.lat, e.latlng.lng);
        });
      }

      mapInstanceRef.current = map;

      // The modal is already laid out around it, so the container has its final
      // size but Leaflet measured it mid-reveal. Without this the tiles fill
      // only part of the box.
      map.invalidateSize();

      // Try to get user's current location if no coordinates set
      if (!lockCoordinates && !formData.coordinates && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            map.setView([userLat, userLng], 15);
            addMarkerToMap(userLat, userLng);
            setFormData(prev => ({
              ...prev,
              coordinates: `${userLat.toFixed(6)}, ${userLng.toFixed(6)}`
            }));
          },
          (error) => {
            console.error('Error getting geolocation:', error);
          }
        );
      }

      if (formData.coordinates) {
        const coords = formData.coordinates.split(',').map(c => c.trim());
        if (coords.length === 2) {
          const lat = parseFloat(coords[0]);
          const lng = parseFloat(coords[1]);
          if (!isNaN(lat) && !isNaN(lng)) {
            addMarkerToMap(lat, lng);
            map.setView([lat, lng], 15);
          }
        }
      }
    } catch (error) {
      console.error('Error initializing map:', error);
    }
  };

  const cleanupMap = () => {
    markerRef.current?.remove();
    markerRef.current = null;
    // remove() rather than dropping the ref: Leaflet holds DOM listeners and a
    // tile pipeline, and the map is created again every time this is toggled.
    mapInstanceRef.current?.remove();
    mapInstanceRef.current = null;
  };

  const handleMapClick = (lat: number, lng: number) => {
    addMarkerToMap(lat, lng);
    setFormData(prev => ({
      ...prev,
      coordinates: `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    }));
    if (errors.coordinates) {
      setErrors(prev => ({ ...prev, coordinates: '' }));
    }
  };

  const addMarkerToMap = (lat: number, lng: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    markerRef.current?.remove();

    markerRef.current = L.marker([lat, lng], {
      icon: selectedPinIcon,
      title: 'Selected Location',
    })
      .addTo(map)
      .bindTooltip(
        `
        <div style="font-family: system-ui; text-align: center; color: #1f2937;">
          <strong>Selected Location</strong><br/>
          <span style="font-size: 12px; color: #666;">${lat.toFixed(6)}, ${lng.toFixed(6)}</span>
        </div>
      `,
        { direction: 'top', opacity: 1 }
      );
  };

  const handleToggleMap = () => {
    setShowCoordinatesMap(!showCoordinatesMap);
  };

  const loadDropdownData = async () => {
    try {
      const [lcpResponse, napResponse, regionsData, citiesData, barangaysData] = await Promise.all([
        apiClient.get<ApiResponse<LCP[]>>('/lcp?limit=1000'),
        apiClient.get<ApiResponse<NAP[]>>('/nap?limit=1000'),
        getRegions(),
        getCities(),
        barangayService.getAll()
      ]);

      const lcpData = lcpResponse.data;
      const napData = napResponse.data;

      if (lcpData.success) {
        setLcpList(lcpData.data || []);
      }
      if (napData.success) {
        setNapList(napData.data || []);
      }
      if (Array.isArray(regionsData)) {
        setRegions(regionsData);
      }
      if (Array.isArray(citiesData)) {
        setAllCities(citiesData);
      }
      if (barangaysData.success && Array.isArray(barangaysData.data)) {
        setAllBarangays(barangaysData.data);
      }
    } catch (error) {
      console.error('Error loading dropdown data:', error);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.lcp_name) {
      newErrors.lcp_name = 'LCP is required';
    }
    if (!formData.nap_name) {
      newErrors.nap_name = 'NAP is required';
    }
    if (!formData.port_total) {
      newErrors.port_total = 'PORT TOTAL is required';
    }
    if (!formData.lcpnap_name.trim()) {
      newErrors.lcpnap_name = 'LCPNAP is required';
    }
    if (!formData.coordinates.trim()) {
      newErrors.coordinates = 'Coordinates is required';
    }
    if (!formData.image && !existingImageUrls.image) {
      newErrors.image = 'Image is required';
    }
    if (!formData.image_2 && !existingImageUrls.image_2) {
      newErrors.image_2 = 'Image 2 is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleImageUpload = async (field: 'reading_image' | 'image' | 'image_2', file: File) => {
    try {
      let processedFile = file;

      if (activeImageSize && activeImageSize.image_size_value < 100) {
        try {
          processedFile = await resizeImage(file, activeImageSize.image_size_value);
        } catch (resizeError) {
          processedFile = file;
        }
      }

      setFormData(prev => ({ ...prev, [field]: processedFile }));

      if (imagePreviews[field]) {
        URL.revokeObjectURL(imagePreviews[field]!);
      }

      const previewUrl = URL.createObjectURL(processedFile);
      setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: '' }));
      }
    } catch (error) {
      setFormData(prev => ({ ...prev, [field]: file }));

      if (imagePreviews[field]) {
        URL.revokeObjectURL(imagePreviews[field]!);
      }

      const previewUrl = URL.createObjectURL(file);
      setImagePreviews(prev => ({ ...prev, [field]: previewUrl }));

      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: '' }));
      }
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setShowLoadingModal(true);
    setUploadProgress(0);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 0.5;
        if (prev >= 70) return prev + 1;
        return prev + 3;
      });
    }, 200);

    try {
      const submitData = new FormData();

      console.log('=== FORM SUBMISSION DEBUG START ===');
      console.log('Form Data:', {
        reading_image: formData.reading_image?.name,
        street: formData.street,
        barangay: formData.barangay,
        city: formData.city,
        region: formData.region,
        lcp_name: formData.lcp_name,
        nap_name: formData.nap_name,
        port_total: formData.port_total,
        lcpnap_name: formData.lcpnap_name,
        coordinates: formData.coordinates,
        image: formData.image?.name,
        image_2: formData.image_2?.name,
        modified_by: formData.modified_by,
      });

      if (formData.reading_image) {
        submitData.append('reading_image', formData.reading_image);
      }
      submitData.append('street', formData.street);
      submitData.append('barangay', formData.barangay);
      submitData.append('city', formData.city);
      submitData.append('region', formData.region);
      submitData.append('lcp_id', formData.lcp_name);
      submitData.append('nap_id', formData.nap_name);
      submitData.append('port_total', formData.port_total);
      submitData.append('lcpnap_name', formData.lcpnap_name);
      submitData.append('coordinates', formData.coordinates);
      if (formData.image) {
        submitData.append('image', formData.image);
      }
      if (formData.image_2) {
        submitData.append('image_2', formData.image_2);
      }
      submitData.append('modified_by', formData.modified_by);

      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;
      if (currentUser?.organization_id) {
        submitData.append('organization_id', String(currentUser.organization_id));
      }

      console.log('FormData entries:');
      Array.from(submitData.entries()).forEach(([key, value]) => {
        if (value instanceof File) {
          console.log(`${key}: File(${value.name}, ${value.size} bytes, ${value.type})`);
        } else {
          console.log(`${key}: ${value}`);
        }
      });

      const endpoint = editData ? `/lcpnap/${editData.id}` : '/lcpnap';
      console.log(`Sending ${editData ? 'PUT' : 'POST'} request to: ${endpoint}`);

      if (editData) {
        submitData.append('_method', 'PUT');
      }

      const response = await apiClient.post<ApiResponse>(endpoint, submitData, { headers: { 'Content-Type': 'multipart/form-data' } });

      const data = response.data;
      console.log('Response data:', data);

      if (!data.success) {
        console.error('Request failed:', data);
        throw new Error(data.message || data.error || 'Failed to save LCPNAP');
      }

      console.log('=== FORM SUBMISSION SUCCESS ===');
      clearInterval(progressInterval);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));
      setShowLoadingModal(false);
      setResultType('success');
      setResultMessage(editData ? 'LCP/NAP location updated successfully' : 'LCP/NAP location created successfully');
      setShowResultModal(true);

      setTimeout(() => {
        setShowResultModal(false);
        onSave();
        handleClose();
      }, 2000);

    } catch (error: any) {
      console.error('=== FORM SUBMISSION ERROR ===');
      console.error('Error type:', error.constructor.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Full error:', error);

      clearInterval(progressInterval);
      setShowLoadingModal(false);

      // Prefer the backend's message (e.g. duplicate LCPNAP) over the generic axios message
      const responseData = error?.response?.data;
      let message: string | undefined = responseData?.message || responseData?.error;

      // If the backend returned field validation errors, surface the first one
      if (responseData?.errors) {
        const fieldErrors = responseData.errors as Record<string, string[] | string>;
        const firstField = Object.values(fieldErrors)[0];
        const firstMessage = Array.isArray(firstField) ? firstField[0] : firstField;
        if (firstMessage) {
          message = message && message !== 'Validation failed' ? message : firstMessage;
        }

        // Flag a duplicate name against the LCPNAP field so it also highlights inline
        if (fieldErrors.lcpnap_name) {
          const lcpnapErr = fieldErrors.lcpnap_name;
          setErrors(prev => ({
            ...prev,
            lcpnap_name: Array.isArray(lcpnapErr) ? lcpnapErr[0] : lcpnapErr,
          }));
        }
      }

      // Duplicate LCPNAP comes back as a plain message with a 422 status
      if (error?.response?.status === 422 && message?.toLowerCase().includes('already exists')) {
        setErrors(prev => ({ ...prev, lcpnap_name: message! }));
      }

      setResultType('error');
      setResultMessage(message || error.message || 'Failed to save LCP/NAP location');
      setShowResultModal(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      reading_image: null,
      street: '',
      barangay: '',
      city: '',
      region: '',
      lcp_name: '',
      nap_name: '',
      port_total: '',
      lcpnap_name: '',
      coordinates: '',
      image: null,
      image_2: null,
      modified_by: currentUserEmail,
    });
    setImagePreviews({
      reading_image: null,
      image: null,
      image_2: null,
    });
    setExistingImageUrls({
      reading_image: null,
      image: null,
      image_2: null,
    });
    setErrors({});
  };

  const populateForm = (data: EditData) => {
    setFormData({
      reading_image: null,
      street: data.street || '',
      barangay: data.barangay || '',
      city: data.city || '',
      region: data.region || '',
      lcp_name: data.lcp_name || '',
      nap_name: data.nap_name || '',
      port_total: data.port_total ? String(data.port_total) : '',
      lcpnap_name: data.lcpnap_name || '',
      coordinates: data.coordinates || '',
      image: null,
      image_2: null,
      modified_by: currentUserEmail,
    });
    const readingPreview = data.reading_image_url ? getDriveDirectUrl(data.reading_image_url) : null;
    const image1Preview = data.image1_url ? getDriveDirectUrl(data.image1_url) : null;
    const image2Preview = data.image2_url ? getDriveDirectUrl(data.image2_url) : null;
    setImagePreviews({
      reading_image: readingPreview,
      image: image1Preview,
      image_2: image2Preview,
    });
    setExistingImageUrls({
      reading_image: readingPreview,
      image: image1Preview,
      image_2: image2Preview,
    });
    setErrors({});
  };

  const handleRegionChange = (regionName: string) => {
    setFormData(prev => ({
      ...prev,
      region: regionName,
      city: '',
      barangay: ''
    }));
  };

  const handleCityChange = (cityName: string) => {
    setFormData(prev => ({
      ...prev,
      city: cityName,
      barangay: ''
    }));
  };

  const handleBarangayChange = (barangayName: string) => {
    setFormData(prev => ({
      ...prev,
      barangay: barangayName
    }));
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

  const filteredCities = getFilteredCities();
  const filteredBarangays = getFilteredBarangays();

  const ImageUploadField: React.FC<{
    label: string;
    field: 'reading_image' | 'image' | 'image_2';
    required?: boolean;
    error?: string;
  }> = ({ label, field, required, error }) => (
    <div>
      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
        }`}>
        {label}{required && <span className="text-red-500">*</span>}
      </label>
      <div className={`relative w-full h-48 border rounded overflow-hidden cursor-pointer ${isDarkMode
        ? 'bg-gray-800 border-gray-700 hover:bg-gray-750'
        : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
        }`}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleImageUpload(field, e.target.files[0]);
            }
          }}
          className="absolute inset-0 opacity-0 cursor-pointer z-10"
        />
        {imagePreviews[field] ? (
          <div className="relative w-full h-full">
            <img
              src={imagePreviews[field]!}
              alt={label}
              className="w-full h-full object-contain"
            />
            <div className="absolute bottom-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center">
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
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );

  if (!isOpen) return null;

  return (
    <>
      {showLoadingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
          <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            <Loader2
              className="w-20 h-20 animate-spin"
              style={{
                color: colorPalette?.primary || '#7c3aed'
              }}
            />
            <div className="text-center">
              <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{loadingPercentage}%</p>
            </div>
          </div>
        </div>
      )}

      {showResultModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
          <div className={`rounded-lg p-8 flex flex-col items-center space-y-4 max-w-md ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            {resultType === 'success' ? (
              <>
                <CheckCircle className="w-16 h-16 text-green-500" />
                <p className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>Success!</p>
                <p className={`text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>{resultMessage}</p>
              </>
            ) : (
              <>
                <AlertCircle className="w-16 h-16 text-red-500" />
                <p className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>Error</p>
                <p className={`text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>{resultMessage}</p>
                <button
                  onClick={() => setShowResultModal(false)}
                  className="mt-4 px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-[9998]"
        onClick={handleClose}
      />

      <div className={`fixed right-0 top-0 h-full w-[600px] shadow-2xl z-[9999] flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
        }`}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDarkMode
          ? 'border-gray-800 bg-gray-800'
          : 'border-gray-300 bg-gray-100'
          }`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{editData ? 'Edit LCP NAP Location' : 'LCP NAP Location Form'}</h2>
          <button onClick={handleClose} className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}>
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-4">
            <ImageUploadField label="Reading Image" field="reading_image" />

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Street</label>
              <input
                type="text"
                value={formData.street}
                onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                className={`w-full px-3 py-2 rounded border focus:outline-none ${isDarkMode
                  ? 'bg-gray-800 text-white border-gray-700'
                  : 'bg-white text-gray-900 border-gray-300'
                  }`}
                style={{
                  borderColor: errors.street ? '#ef4444' : undefined,
                  boxShadow: !errors.street && formData.street ? `0 0 0 2px ${colorPalette?.primary}20` : undefined
                }}
                onFocus={(e) => {
                  if (!errors.street) e.target.style.borderColor = colorPalette?.primary || '#7c3aed';
                }}
                onBlur={(e) => {
                  if (!errors.street) e.target.style.borderColor = '';
                }}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Region</label>
              <div className="relative">
                <select
                  value={formData.region}
                  onChange={(e) => handleRegionChange(e.target.value)}
                  className={`w-full px-3 py-2 rounded border focus:outline-none appearance-none ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    }`}
                  onFocus={(e) => e.target.style.borderColor = colorPalette?.primary || '#7c3aed'}
                  onBlur={(e) => e.target.style.borderColor = ''}
                >
                  <option value="">Select Region</option>
                  {regions.map(region => (
                    <option key={region.id} value={region.name}>{region.name}</option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>City</label>
              <div className="relative">
                <select
                  value={formData.city}
                  onChange={(e) => handleCityChange(e.target.value)}
                  disabled={!formData.region}
                  className={`w-full px-3 py-2 rounded border focus:outline-none disabled:opacity-50 appearance-none ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    }`}
                  onFocus={(e) => e.target.style.borderColor = colorPalette?.primary || '#7c3aed'}
                  onBlur={(e) => e.target.style.borderColor = ''}
                >
                  <option value="">{formData.region ? 'Select City' : 'All'}</option>
                  {filteredCities.map(city => (
                    <option key={city.id} value={city.name}>{city.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Barangay</label>
              <div className="relative">
                <select
                  value={formData.barangay}
                  onChange={(e) => handleBarangayChange(e.target.value)}
                  disabled={!formData.city}
                  className={`w-full px-3 py-2 rounded border focus:outline-none disabled:opacity-50 appearance-none ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    }`}
                  onFocus={(e) => e.target.style.borderColor = colorPalette?.primary || '#7c3aed'}
                  onBlur={(e) => e.target.style.borderColor = ''}
                >
                  <option value="">{formData.city ? 'Select Barangay' : 'All'}</option>
                  {filteredBarangays.map(barangay => (
                    <option key={barangay.id} value={barangay.barangay}>{barangay.barangay}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                LCP<span className="text-red-500">*</span>
              </label>
              <select
                value={formData.lcp_name}
                onChange={(e) => setFormData({ ...formData, lcp_name: e.target.value })}
                className={`w-full px-3 py-2 rounded border focus:outline-none ${isDarkMode
                  ? 'bg-gray-800 text-white border-gray-700'
                  : 'bg-white text-gray-900 border-gray-300'
                  }`}
                onFocus={(e) => e.target.style.borderColor = colorPalette?.primary || '#7c3aed'}
                onBlur={(e) => e.target.style.borderColor = ''}
              >
                <option value="">Select LCP</option>
                {lcpList.map(lcp => (
                  <option key={lcp.id} value={lcp.lcp_name}>{lcp.lcp_name}</option>
                ))}
              </select>
              {errors.lcp_name && <p className="text-red-500 text-xs mt-1">{errors.lcp_name}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                NAP<span className="text-red-500">*</span>
              </label>
              <select
                value={formData.nap_name}
                onChange={(e) => setFormData({ ...formData, nap_name: e.target.value })}
                className={`w-full px-3 py-2 rounded border focus:outline-none ${isDarkMode
                  ? 'bg-gray-800 text-white border-gray-700'
                  : 'bg-white text-gray-900 border-gray-300'
                  }`}
                onFocus={(e) => e.target.style.borderColor = colorPalette?.primary || '#7c3aed'}
                onBlur={(e) => e.target.style.borderColor = ''}
              >
                <option value="">Select NAP</option>
                {napList.map(nap => (
                  <option key={nap.id} value={nap.nap_name}>{nap.nap_name}</option>
                ))}
              </select>
              {errors.nap_name && <p className="text-red-500 text-xs mt-1">{errors.nap_name}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                PORT TOTAL<span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, port_total: '8' })}
                  className={`py-3 px-4 rounded border transition-colors ${formData.port_total === '8'
                    ? 'text-white'
                    : isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-300'
                      : 'bg-white border-gray-300 text-gray-700'
                    }`}
                  style={{
                    backgroundColor: formData.port_total === '8' ? (colorPalette?.primary || '#7c3aed') : undefined,
                    borderColor: formData.port_total === '8' ? (colorPalette?.primary || '#7c3aed') : undefined,
                  }}
                >
                  8
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, port_total: '16' })}
                  className={`py-3 px-4 rounded border transition-colors ${formData.port_total === '16'
                    ? 'text-white'
                    : isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-300'
                      : 'bg-white border-gray-300 text-gray-700'
                    }`}
                  style={{
                    backgroundColor: formData.port_total === '16' ? (colorPalette?.primary || '#7c3aed') : undefined,
                    borderColor: formData.port_total === '16' ? (colorPalette?.primary || '#7c3aed') : undefined,
                  }}
                >
                  16
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, port_total: '32' })}
                  className={`py-3 px-4 rounded border transition-colors ${formData.port_total === '32'
                    ? 'text-white'
                    : isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-300'
                      : 'bg-white border-gray-300 text-gray-700'
                    }`}
                  style={{
                    backgroundColor: formData.port_total === '32' ? (colorPalette?.primary || '#7c3aed') : undefined,
                    borderColor: formData.port_total === '32' ? (colorPalette?.primary || '#7c3aed') : undefined,
                  }}
                >
                  32
                </button>
              </div>
              {errors.port_total && <p className="text-red-500 text-xs mt-1">{errors.port_total}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                LCPNAP<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.lcpnap_name}
                readOnly
                className={`w-full px-3 py-2 rounded border cursor-not-allowed ${isDarkMode
                  ? 'bg-gray-700 text-gray-300 border-gray-700'
                  : 'bg-gray-100 text-gray-600 border-gray-300'
                  }`}
                placeholder="Auto-generated from LCP and NAP"
              />
              {errors.lcpnap_name && <p className="text-red-500 text-xs mt-1">{errors.lcpnap_name}</p>}
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>Format: LCP-XXX NAP-XXX</p>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                Coordinates<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.coordinates}
                  onChange={(e) => setFormData({ ...formData, coordinates: e.target.value })}
                  readOnly={lockCoordinates}
                  title={lockCoordinates ? 'Set by the pin you confirmed on the map' : undefined}
                  placeholder="14.466580, 121.201807"
                  className={`w-full px-3 py-2 pr-10 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-800 text-white border-gray-700'
                    : 'bg-white text-gray-900 border-gray-300'
                    } ${lockCoordinates ? 'cursor-not-allowed opacity-80' : ''}`}
                  onFocus={(e) => e.target.style.borderColor = colorPalette?.primary || '#7c3aed'}
                  onBlur={(e) => e.target.style.borderColor = ''}
                />
                <button
                  type="button"
                  onClick={handleToggleMap}
                  className={`absolute right-3 top-2.5 transition-colors ${isDarkMode
                    ? 'text-gray-400 hover:text-white'
                    : 'text-gray-600 hover:text-gray-900'
                    }`}
                  style={{
                    color: showCoordinatesMap ? (colorPalette?.primary || '#7c3aed') : undefined
                  }}
                >
                  <MapPin size={20} />
                </button>
              </div>
              {errors.coordinates && <p className="text-red-500 text-xs mt-1">{errors.coordinates}</p>}

              {showCoordinatesMap && (
                <div className={`mt-3 border rounded overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  }`}>
                  <div
                    ref={mapRef}
                    className={isDarkMode ? 'w-full h-[400px] bg-gray-800' : 'w-full h-[400px] bg-gray-100'}
                  />
                  <div className={`px-3 py-2 text-xs border-t ${isDarkMode
                    ? 'bg-gray-800 text-gray-400 border-gray-700'
                    : 'bg-gray-100 text-gray-600 border-gray-300'
                    }`}>
                    {lockCoordinates
                      ? 'Pinned on the map. Cancel and drop a new pin to move it.'
                      : 'Click on the map to set coordinates'}
                  </div>
                </div>
              )}
            </div>

            <ImageUploadField label="Image" field="image" required error={errors.image} />

            <ImageUploadField label="Image 2" field="image_2" required error={errors.image_2} />

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Modified By</label>
              <input
                type="text"
                value={formData.modified_by}
                readOnly
                className={`w-full px-3 py-2 rounded border cursor-not-allowed ${isDarkMode
                  ? 'bg-gray-800 text-gray-400 border-gray-700'
                  : 'bg-gray-100 text-gray-600 border-gray-300'
                  }`}
              />
            </div>
          </div>
        </div>

        <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${isDarkMode
          ? 'border-gray-800 bg-gray-800'
          : 'border-gray-300 bg-gray-100'
          }`}>
          <button
            onClick={handleClose}
            className={`px-4 py-2 border rounded ${isDarkMode
              ? 'text-orange-400 hover:text-orange-300 border-orange-600 hover:border-orange-500 bg-transparent'
              : 'text-orange-600 hover:text-orange-700 border-orange-600 hover:border-orange-700 bg-transparent'
              }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
            {loading ? (editData ? 'Updating...' : 'Saving...') : (editData ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
    </>
  );
};

export default AddLcpNapLocationModal;
