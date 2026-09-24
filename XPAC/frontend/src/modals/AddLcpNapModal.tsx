import React, { useState, useEffect } from 'react';
import { X, Camera, MapPin } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';

interface AddLcpNapModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingItem?: LcpNapItem | null;
}

interface LcpNapItem {
  id: number;
  lcpnap: string;
  lcp: string;
  nap: string;
  port_total: number;
  image?: string;
  modified_by?: string;
  modified_date?: string;
  image2?: string;
  reading_image?: string;
  street?: string;
  barangay?: string;
  city?: string;
  region?: string;
  related_billing_details?: string;
  lcp_id?: number;
  nap_id?: number;
}

const AddLcpNapModal: React.FC<AddLcpNapModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingItem
}) => {
  const [formData, setFormData] = useState({
    lcpnap: '',
    lcp_id: '',
    nap_id: '',
    port_total: 8,
    image: null as File | null,
    image2: null as File | null,
    reading_image: null as File | null,
    street: '',
    barangay: '',
    city: '',
    region: '',
    coordinates: '',
    related_billing_details: '',
    modified_by: '',
    modified_date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' pm'
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const [regions, setRegions] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [barangays, setBarangays] = useState<any[]>([]);
  const [lcpList, setLcpList] = useState<any[]>([]);
  const [napList, setNapList] = useState<any[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);

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
    const fetchActiveImageSize = async () => {
      if (isOpen) {
        try {
          const imageSizeSettings = await getActiveImageSize();
          setActiveImageSize(imageSizeSettings);
          console.log('Active image size settings:', imageSizeSettings);
        } catch (error) {
          console.error('Error fetching active image size:', error);
        }
      }
    };
    fetchActiveImageSize();
  }, [isOpen]);

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    let userEmail = 'Unknown User';

    if (authData) {
      try {
        const userData = JSON.parse(authData);
        userEmail = userData.email || userData.email_address || 'Unknown User';
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }

    if (isOpen) {
      loadDropdownData();

      if (editingItem) {
        setFormData({
          lcpnap: editingItem.lcpnap,
          lcp_id: editingItem.lcp_id?.toString() || '',
          nap_id: editingItem.nap_id?.toString() || '',
          port_total: editingItem.port_total,
          image: null,
          image2: null,
          reading_image: null,
          street: editingItem.street || '',
          barangay: editingItem.barangay || '',
          city: editingItem.city || '',
          region: editingItem.region || '',
          coordinates: '',
          related_billing_details: editingItem.related_billing_details || '',
          modified_by: userEmail,
          modified_date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' pm'
        });
      } else {
        resetForm();
        setFormData(prev => ({ ...prev, modified_by: userEmail }));
      }
    }
  }, [isOpen, editingItem]);

  const loadDropdownData = async () => {
    try {
      const [lcpResponse, napResponse, regionsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/lcp`),
        fetch(`${API_BASE_URL}/nap`),
        fetch(`${API_BASE_URL}/locations/regions`)
      ]);

      const lcpData = await lcpResponse.json();
      const napData = await napResponse.json();
      const regionsData = await regionsResponse.json();

      if (lcpData.success) setLcpList(lcpData.data || []);
      if (napData.success) setNapList(napData.data || []);
      if (regionsData.success) setRegions(regionsData.data || []);
    } catch (error) {
      console.error('Error loading dropdown data:', error);
    }
  };

  const loadCitiesByRegion = async (regionId: string) => {
    if (!regionId) {
      setCities([]);
      setBarangays([]);
      return;
    }

    setIsLoadingLocations(true);
    try {
      const response = await fetch(`${API_BASE_URL}/locations/regions/${regionId}/cities`);
      const data = await response.json();
      if (data.success) setCities(data.data || []);
    } catch (error) {
      console.error('Error loading cities:', error);
    } finally {
      setIsLoadingLocations(false);
    }
  };

  const loadBarangaysByCity = async (cityId: string) => {
    if (!cityId) {
      setBarangays([]);
      return;
    }

    setIsLoadingLocations(true);
    try {
      const response = await fetch(`${API_BASE_URL}/locations/cities/${cityId}/barangays`);
      const data = await response.json();
      if (data.success) setBarangays(data.data || []);
    } catch (error) {
      console.error('Error loading barangays:', error);
    } finally {
      setIsLoadingLocations(false);
    }
  };

  const handleRegionChange = (regionId: string) => {
    setFormData({
      ...formData,
      region: regionId,
      city: '',
      barangay: ''
    });
    setCities([]);
    setBarangays([]);

    if (regionId) {
      loadCitiesByRegion(regionId);
    }
  };

  const handleCityChange = (cityId: string) => {
    setFormData({
      ...formData,
      city: cityId,
      barangay: ''
    });
    setBarangays([]);

    if (cityId) {
      loadBarangaysByCity(cityId);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
    const { files } = e.target;
    if (files && files.length > 0) {
      const file = files[0];

      if (activeImageSize && activeImageSize.image_size_value < 100) {
        try {
          console.log(`Resizing ${fieldName} image...`);
          console.log('Original file size:', (file.size / 1024 / 1024).toFixed(2), 'MB');

          const resizedFile = await resizeImage(file, activeImageSize.image_size_value);

          console.log('Resized file size:', (resizedFile.size / 1024 / 1024).toFixed(2), 'MB');
          console.log('Size reduction:', ((1 - resizedFile.size / file.size) * 100).toFixed(2), '%');

          const fileToUse = resizedFile.size < file.size ? resizedFile : file;
          setFormData(prev => ({
            ...prev,
            [fieldName]: fileToUse
          }));
        } catch (error) {
          console.error('Error resizing image:', error);
          setFormData(prev => ({
            ...prev,
            [fieldName]: file
          }));
        }
      } else {
        setFormData(prev => ({
          ...prev,
          [fieldName]: file
        }));
      }
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.lcpnap.trim()) {
      newErrors.lcpnap = 'LCPNAP is required';
    }

    if (!formData.lcp_id) {
      newErrors.lcp_id = 'LCP is required';
    }

    if (!formData.nap_id) {
      newErrors.nap_id = 'NAP is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append('lcpnap_name', formData.lcpnap.trim());
      formDataToSend.append('lcp_id', formData.lcp_id.toString());
      formDataToSend.append('nap_id', formData.nap_id.toString());
      formDataToSend.append('port_total', formData.port_total.toString());
      formDataToSend.append('street', formData.street.trim());
      formDataToSend.append('barangay', formData.barangay.trim());
      formDataToSend.append('city', formData.city.trim());
      formDataToSend.append('region', formData.region.trim());
      formDataToSend.append('coordinates', formData.coordinates.trim());
      formDataToSend.append('related_billing_details', formData.related_billing_details.trim());

      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;
      if (currentUser?.organization_id) {
        formDataToSend.append('organization_id', String(currentUser.organization_id));
      }

      if (formData.image) {
        formDataToSend.append('image', formData.image);
      }
      if (formData.image2) {
        formDataToSend.append('image2', formData.image2);
      }
      if (formData.reading_image) {
        formDataToSend.append('reading_image', formData.reading_image);
      }

      const url = editingItem
        ? `${API_BASE_URL}/lcp-nap-list/${editingItem.id}`
        : `${API_BASE_URL}/lcp-nap-list`;

      const method = editingItem ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Accept': 'application/json',
        },
        body: formDataToSend,
      });

      const data = await response.json();

      if (response.ok && data.success) {
        alert(data.message || `LCP NAP item ${editingItem ? 'updated' : 'added'} successfully`);
        onSave();
        handleClose();
      } else {
        if (data.errors) {
          const errorMessages = Object.values(data.errors).flat().join('\n');
          alert('Validation errors:\n' + errorMessages);
        } else {
          alert(data.message || `Failed to ${editingItem ? 'update' : 'add'} LCP NAP item`);
        }
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      alert(`Failed to ${editingItem ? 'update' : 'add'} LCP NAP item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const resetForm = () => {
    const authData = localStorage.getItem('authData');
    let userEmail = 'Unknown User';

    if (authData) {
      try {
        const userData = JSON.parse(authData);
        userEmail = userData.email || userData.email_address || 'Unknown User';
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }

    setFormData({
      lcpnap: '',
      lcp_id: '',
      nap_id: '',
      port_total: 8,
      image: null,
      image2: null,
      reading_image: null,
      street: '',
      barangay: '',
      city: '',
      region: '',
      coordinates: '',
      related_billing_details: '',
      modified_by: userEmail,
      modified_date: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' pm'
    });

    setCities([]);
    setBarangays([]);
    setErrors({});
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50" onClick={handleClose}>
      <div
        className={`h-full w-3/4 md:w-full md:max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-gray-100 border-gray-300'
          }`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{editingItem ? 'Edit LCP NAP' : 'Add LCP NAP'}</h2>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleClose}
              className={`px-4 py-2 rounded text-sm ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
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
              onClick={handleClose}
              className={isDarkMode ? 'text-gray-400 hover:text-white transition-colors' : 'text-gray-600 hover:text-gray-900 transition-colors'}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Reading Image
            </label>
            <div className={`w-full h-32 border-2 border-dashed rounded-lg flex items-center justify-center relative cursor-pointer ${isDarkMode
                ? 'bg-gray-800 border-gray-600 hover:border-gray-500'
                : 'bg-gray-100 border-gray-400 hover:border-gray-500'
              }`}>
              <input
                type="file"
                onChange={(e) => handleFileChange(e, 'reading_image')}
                accept="image/*"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {formData.reading_image ? (
                <div className="text-center">
                  <Camera className="w-8 h-8 mx-auto text-green-400 mb-2" />
                  <p className="text-sm text-green-400">{formData.reading_image.name}</p>
                </div>
              ) : (
                <Camera className={`w-12 h-12 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`} />
              )}
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Street
            </label>
            <input
              type="text"
              value={formData.street}
              onChange={(e) => setFormData({ ...formData, street: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                }`}
              placeholder="Enter street"
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Region
            </label>
            <select
              value={formData.region}
              onChange={(e) => handleRegionChange(e.target.value)}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                }`}
              disabled={isLoadingLocations}
            >
              <option value="">Select Region</option>
              {regions.map(region => (
                <option key={region.id} value={region.id.toString()}>{region.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              City
            </label>
            <select
              value={formData.city}
              onChange={(e) => handleCityChange(e.target.value)}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                }`}
              disabled={!formData.region || isLoadingLocations}
            >
              <option value="">Select City</option>
              {cities.map(city => (
                <option key={city.id} value={city.id.toString()}>{city.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Barangay
            </label>
            <select
              value={formData.barangay}
              onChange={(e) => setFormData({ ...formData, barangay: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                }`}
              disabled={!formData.city || isLoadingLocations}
            >
              <option value="">Select Barangay</option>
              {barangays.map(barangay => (
                <option key={barangay.id} value={barangay.id.toString()}>{barangay.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              LCP<span className="text-red-500">*</span>
            </label>
            <select
              value={formData.lcp_id}
              onChange={(e) => setFormData({ ...formData, lcp_id: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.lcp_id ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
            >
              <option value="">Select LCP</option>
              {lcpList.map(lcp => (
                <option key={lcp.id} value={lcp.id.toString()}>
                  {lcp.lcp_name}
                </option>
              ))}
            </select>
            {errors.lcp_id && <p className="text-red-500 text-xs mt-1">{errors.lcp_id}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              NAP<span className="text-red-500">*</span>
            </label>
            <select
              value={formData.nap_id}
              onChange={(e) => setFormData({ ...formData, nap_id: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.nap_id ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
            >
              <option value="">Select NAP</option>
              {napList.map(nap => (
                <option key={nap.id} value={nap.id.toString()}>
                  {nap.nap_name}
                </option>
              ))}
            </select>
            {errors.nap_id && <p className="text-red-500 text-xs mt-1">{errors.nap_id}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              PORT TOTAL<span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {[8, 16, 32].map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormData({ ...formData, port_total: value })}
                  className={`flex-1 px-6 py-3 rounded border text-center font-medium ${formData.port_total === value
                      ? 'bg-orange-600 text-white border-orange-600'
                      : isDarkMode
                        ? 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              LCPNAP<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.lcpnap}
              onChange={(e) => setFormData({ ...formData, lcpnap: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.lcpnap ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
              placeholder="Enter LCPNAP"
            />
            {errors.lcpnap && <p className="text-red-500 text-xs mt-1">{errors.lcpnap}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Coordinates
            </label>
            <div className="relative">
              <input
                type="text"
                value={formData.coordinates}
                onChange={(e) => setFormData({ ...formData, coordinates: e.target.value })}
                className={`w-full px-3 py-2 pr-10 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                  }`}
                placeholder="Enter coordinates"
              />
              <MapPin className={`absolute right-3 top-2.5 h-5 w-5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                }`} />
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Image
            </label>
            <div className={`w-full h-32 border-2 border-dashed rounded-lg flex items-center justify-center relative cursor-pointer ${isDarkMode
                ? 'bg-gray-800 border-gray-600 hover:border-gray-500'
                : 'bg-gray-100 border-gray-400 hover:border-gray-500'
              }`}>
              <input
                type="file"
                onChange={(e) => handleFileChange(e, 'image')}
                accept="image/*"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {formData.image ? (
                <div className="text-center">
                  <Camera className="w-8 h-8 mx-auto text-green-400 mb-2" />
                  <p className="text-sm text-green-400">{formData.image.name}</p>
                </div>
              ) : (
                <Camera className="w-12 h-12 text-gray-500" />
              )}
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Image 2
            </label>
            <div className={`w-full h-32 border-2 border-dashed rounded-lg flex items-center justify-center relative cursor-pointer ${isDarkMode
                ? 'bg-gray-800 border-gray-600 hover:border-gray-500'
                : 'bg-gray-100 border-gray-400 hover:border-gray-500'
              }`}>
              <input
                type="file"
                onChange={(e) => handleFileChange(e, 'image2')}
                accept="image/*"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              {formData.image2 ? (
                <div className="text-center">
                  <Camera className="w-8 h-8 mx-auto text-green-400 mb-2" />
                  <p className="text-sm text-green-400">{formData.image2.name}</p>
                </div>
              ) : (
                <Camera className="w-12 h-12 text-gray-500" />
              )}
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Related Billing Details
            </label>
            <textarea
              value={formData.related_billing_details}
              onChange={(e) => setFormData({ ...formData, related_billing_details: e.target.value })}
              rows={3}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                }`}
              placeholder="Enter billing details"
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Modified By
            </label>
            <input
              type="text"
              value={formData.modified_by}
              readOnly
              className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-gray-400'
                  : 'bg-gray-100 border-gray-300 text-gray-600'
                }`}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Modified Date
            </label>
            <input
              type="text"
              value={formData.modified_date}
              readOnly
              className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-gray-400'
                  : 'bg-gray-100 border-gray-300 text-gray-600'
                }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddLcpNapModal;
