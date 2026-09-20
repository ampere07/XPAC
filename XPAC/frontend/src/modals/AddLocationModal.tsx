import React, { useState, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';
import {
  createRegion,
  createCity,
  createBarangay,
  getRegions,
  getCities,
  getBoroughs,
  Region,
  City,
  Borough
} from '../services/cityService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface AddLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (locationData: LocationFormData) => void;
  initialLocationType?: 'region' | 'city' | 'barangay';
}

interface LocationFormData {
  regionId: number | null;
  cityId: number | null;
  barangayId: number | null;
}

const AddLocationModal: React.FC<AddLocationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialLocationType
}) => {
  const [formData, setFormData] = useState<LocationFormData & { is_active: boolean }>({
    regionId: null,
    cityId: null,
    barangayId: null,
    is_active: true
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const [newRegionName, setNewRegionName] = useState('');
  const [newCityName, setNewCityName] = useState('');
  const [newBarangayName, setNewBarangayName] = useState('');

  const [showNewRegionInput, setShowNewRegionInput] = useState(false);
  const [showNewCityInput, setShowNewCityInput] = useState(false);
  const [showNewBarangayInput, setShowNewBarangayInput] = useState(false);

  const [allRegions, setAllRegions] = useState<Region[]>([]);
  const [allCities, setAllCities] = useState<City[]>([]);
  const [allBarangays, setAllBarangays] = useState<Borough[]>([]);

  const [filteredCities, setFilteredCities] = useState<City[]>([]);
  const [filteredBarangays, setFilteredBarangays] = useState<Borough[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  const showGlobalModal = (
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning', 
    title: string, 
    message: string,
    onConfirm?: () => void
  ) => {
    setGlobalModal({
      isOpen: true,
      type,
      title,
      message,
      onConfirm
    });
  };

  const closeGlobalModal = () => {
    setGlobalModal(prev => ({ ...prev, isOpen: false }));
  };

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
      fetchAllLocationData();
    }
  }, [isOpen]);

  const fetchAllLocationData = async () => {
    setDataLoading(true);
    try {
      const [regions, cities, barangays] = await Promise.all([
        getRegions(),
        getCities(),
        getBoroughs()
      ]);

      setAllRegions(regions);
      setAllCities(cities);
      setAllBarangays(barangays);
    } catch (error) {
      console.error('Error fetching location data:', error);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (formData.regionId) {
      const filtered = allCities.filter(city => city.region_id === formData.regionId);
      setFilteredCities(filtered);
    } else {
      setFilteredCities([]);
    }
    setFormData(prev => ({ ...prev, cityId: null, barangayId: null }));
  }, [formData.regionId, allCities]);

  useEffect(() => {
    if (formData.cityId) {
      const filtered = allBarangays.filter(barangay => barangay.city_id === formData.cityId);
      setFilteredBarangays(filtered);
    } else {
      setFilteredBarangays([]);
    }
    setFormData(prev => ({ ...prev, barangayId: null }));
  }, [formData.cityId, allBarangays]);

  const handleInputChange = (field: keyof LocationFormData, value: string | number | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleRegionChange = (value: string) => {
    if (value === 'add_new') {
      setShowNewRegionInput(true);
      handleInputChange('regionId', null);
    } else {
      setShowNewRegionInput(false);
      handleInputChange('regionId', parseInt(value));
    }
  };

  const handleCityChange = (value: string) => {
    if (value === 'add_new') {
      setShowNewCityInput(true);
      handleInputChange('cityId', null);
    } else {
      setShowNewCityInput(false);
      handleInputChange('cityId', parseInt(value));
    }
  };

  const handleBarangayChange = (value: string) => {
    if (value === 'add_new') {
      setShowNewBarangayInput(true);
      handleInputChange('barangayId', null);
    } else {
      setShowNewBarangayInput(false);
      handleInputChange('barangayId', parseInt(value));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.regionId && !showNewRegionInput) {
      newErrors.regionId = 'Region is required';
    }

    if ((formData.cityId || showNewCityInput) && !formData.regionId && !showNewRegionInput) {
      newErrors.regionId = 'Region must be selected before adding a city';
    }

    if ((formData.barangayId || showNewBarangayInput) && !formData.cityId && !showNewCityInput) {
      newErrors.cityId = 'City must be selected before adding a barangay';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    const isValid = validateForm();

    if (!isValid) {
      return;
    }

    setLoading(true);
    showGlobalModal('loading', 'Saving Location', 'Creating your new location...');

    try {
      const locationData: any = {
        region: {
          isNew: showNewRegionInput,
          name: showNewRegionInput ? newRegionName : null,
          id: formData.regionId
        },
        city: {
          isNew: showNewCityInput,
          name: showNewCityInput ? newCityName : null,
          id: formData.cityId
        },
        barangay: {
          isNew: showNewBarangayInput,
          name: showNewBarangayInput ? newBarangayName : null,
          id: formData.barangayId
        }
      };

      if (locationData.barangay.isNew && !locationData.city.isNew && !locationData.city.id) {
        showGlobalModal('warning', 'Required Information', 'Please select a city or create a new one before adding a barangay');
        setLoading(false);
        return;
      }

      if ((locationData.city.isNew || locationData.barangay.isNew) && !locationData.region.isNew && !locationData.region.id) {
        showGlobalModal('warning', 'Required Information', 'Please select a region or create a new one before adding a city or barangay');
        setLoading(false);
        return;
      }

      let regionId = locationData.region.id;
      if (locationData.region.isNew) {
        if (!locationData.region.name.trim()) {
           showGlobalModal('warning', 'Required Information', 'Please enter a region name');
           setLoading(false);
           return;
        }
        const authData = localStorage.getItem('authData');
        const currentUser = authData ? JSON.parse(authData) : null;
        const organizationId = currentUser?.organization_id ?? null;
        let userEmail = currentUser?.email || currentUser?.email_address || '';
        const newRegion = await createRegion({ 
          name: locationData.region.name, 
          modified_by: userEmail,
          is_active: formData.is_active,
          ...(organizationId ? { organization_id: organizationId } : {})
        });
        regionId = newRegion.id;
      }

      let cityId = locationData.city.id;
      if (locationData.city.isNew && regionId) {
        if (!locationData.city.name.trim()) {
           showGlobalModal('warning', 'Required Information', 'Please enter a city name');
           setLoading(false);
           return;
        }
        const authData = localStorage.getItem('authData');
        const currentUser = authData ? JSON.parse(authData) : null;
        const organizationId = currentUser?.organization_id ?? null;
        let userEmail = currentUser?.email || currentUser?.email_address || '';
        const newCity = await createCity({
          name: locationData.city.name,
          region_id: regionId,
          modified_by: userEmail,
          is_active: formData.is_active,
          ...(organizationId ? { organization_id: organizationId } : {})
        });
        cityId = newCity.id;
      }

      if (locationData.barangay.isNew && cityId) {
        if (!locationData.barangay.name.trim()) {
           showGlobalModal('warning', 'Required Information', 'Please enter a barangay name');
           setLoading(false);
           return;
        }
        const authData = localStorage.getItem('authData');
        const currentUser = authData ? JSON.parse(authData) : null;
        const organizationId = currentUser?.organization_id ?? null;
        let userEmail = currentUser?.email || currentUser?.email_address || '';
        await createBarangay({
          name: locationData.barangay.name,
          city_id: cityId,
          modified_by: userEmail,
          is_active: formData.is_active,
          ...(organizationId ? { organization_id: organizationId } : {})
        });
      }

      const createdLocations = [];
      if (locationData.region.isNew) createdLocations.push(`Region: ${locationData.region.name}`);
      if (locationData.city.isNew) createdLocations.push(`City: ${locationData.city.name}`);
      if (locationData.barangay.isNew) createdLocations.push(`Barangay: ${locationData.barangay.name}`);

      showGlobalModal(
        'success', 
        'Success', 
        `Successfully created:\n${createdLocations.length > 0 ? createdLocations.join('\n') : 'Location updated successfully'}`,
        () => {
          closeGlobalModal();
          onSave(locationData);
          handleClose();
        }
      );
    } catch (error: any) {
      console.error('Error creating location:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to create location. Please try again.';
      showGlobalModal('error', 'Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      regionId: null,
      cityId: null,
      barangayId: null,
      is_active: true
    });
    setErrors({});
    setShowNewRegionInput(false);
    setShowNewCityInput(false);
    setShowNewBarangayInput(false);
    setNewRegionName('');
    setNewCityName('');
    setNewBarangayName('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
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
              }`}>Add Location</h2>
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
                onClick={handleClose}
                className={isDarkMode ? 'text-gray-400 hover:text-white transition-colors' : 'text-gray-600 hover:text-gray-900 transition-colors'}
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {dataLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8" style={{ borderBottomColor: colorPalette?.primary || '#7c3aed' }}></div>
              </div>
            ) : (
              <>
                <div className="flex items-center space-x-2 pb-2 mb-4 border-b border-dashed border-gray-700">
                  <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Status</span>
                  <label className="flex items-center cursor-pointer group ml-auto">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                        className="sr-only"
                      />
                      <div className={`w-10 h-5 rounded-full shadow-inner transition-colors duration-200 ease-in-out ${
                        formData.is_active 
                          ? (isDarkMode ? 'bg-opacity-50' : 'bg-opacity-100')
                          : (isDarkMode ? 'bg-gray-700' : 'bg-gray-300')
                      }`}
                      style={{ 
                        backgroundColor: formData.is_active ? (colorPalette?.primary || '#7c3aed') : undefined 
                      }}></div>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transform transition-transform duration-200 ease-in-out ${
                        formData.is_active ? 'translate-x-5' : 'translate-x-0'
                      }`}></div>
                    </div>
                    <span className={`ml-3 text-xs font-bold uppercase transition-colors ${
                      formData.is_active 
                        ? (isDarkMode ? 'text-white' : 'text-black') 
                        : (isDarkMode ? 'text-gray-500' : 'text-gray-400')
                    }`}
                    style={{ color: formData.is_active ? (colorPalette?.primary || undefined) : undefined }}>
                      {formData.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Region<span className="text-red-500">*</span>
                  </label>
                  {showNewRegionInput ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={newRegionName}
                        onChange={(e) => setNewRegionName(e.target.value)}
                        placeholder="Enter new region name"
                        className={`w-full px-3 py-2 border rounded focus:outline-none transition-all duration-200 ${isDarkMode
                          ? 'bg-gray-800 text-white'
                          : 'bg-white text-gray-900'
                          }`}
                        style={{
                          borderColor: colorPalette?.primary || '#7c3aed',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                          e.currentTarget.style.boxShadow = `0 0 0 2px ${colorPalette?.primary || '#7c3aed'}20`;
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          setShowNewRegionInput(false);
                          setNewRegionName('');
                        }}
                        className={isDarkMode ? 'absolute right-3 top-2.5 text-gray-400 hover:text-white' : 'absolute right-3 top-2.5 text-gray-600 hover:text-gray-900'}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={formData.regionId?.toString() || ''}
                        onChange={(e) => handleRegionChange(e.target.value)}
                        className={`w-full px-3 py-2 border rounded focus:outline-none appearance-none transition-all duration-200 ${errors.regionId ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                          } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                          }`}
                        onFocus={(e) => {
                          if (!errors.regionId) {
                            e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                            e.currentTarget.style.boxShadow = `0 0 0 2px ${colorPalette?.primary || '#7c3aed'}20`;
                          }
                        }}
                        onBlur={(e) => {
                          if (!errors.regionId) {
                            e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                            e.currentTarget.style.boxShadow = 'none';
                          }
                        }}
                      >
                        <option value="">Select Region</option>
                        {allRegions.map(region => (
                          <option key={region.id} value={region.id}>{region.name}</option>
                        ))}
                        <option value="add_new" style={{ color: colorPalette?.primary || '#7c3aed' }}>+ Add New Region</option>
                      </select>
                      <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`} size={20} />
                    </div>
                  )}
                  {errors.regionId && <p className="text-red-500 text-xs mt-1">{errors.regionId}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    City<span className="text-red-500">*</span>
                  </label>
                  {showNewCityInput ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={newCityName}
                        onChange={(e) => setNewCityName(e.target.value)}
                        placeholder="Enter new city name"
                        className={`w-full px-3 py-2 border rounded focus:outline-none transition-all duration-200 ${isDarkMode
                          ? 'bg-gray-800 text-white'
                          : 'bg-white text-gray-900'
                          }`}
                        style={{
                          borderColor: colorPalette?.primary || '#7c3aed',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                          e.currentTarget.style.boxShadow = `0 0 0 2px ${colorPalette?.primary || '#7c3aed'}20`;
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          setShowNewCityInput(false);
                          setNewCityName('');
                        }}
                        className={isDarkMode ? 'absolute right-3 top-2.5 text-gray-400 hover:text-white' : 'absolute right-3 top-2.5 text-gray-600 hover:text-gray-900'}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={formData.cityId?.toString() || ''}
                        onChange={(e) => handleCityChange(e.target.value)}
                        disabled={!formData.regionId && !showNewRegionInput}
                        className={`w-full px-3 py-2 border rounded focus:outline-none appearance-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${errors.cityId ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                          } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                          }`}
                        onFocus={(e) => {
                          if (!errors.cityId) {
                            e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                            e.currentTarget.style.boxShadow = `0 0 0 2px ${colorPalette?.primary || '#7c3aed'}20`;
                          }
                        }}
                        onBlur={(e) => {
                          if (!errors.cityId) {
                            e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                            e.currentTarget.style.boxShadow = 'none';
                          }
                        }}
                      >
                        <option value="">Select City</option>
                        {filteredCities.map(city => (
                          <option key={city.id} value={city.id}>{city.name}</option>
                        ))}
                        <option value="add_new" style={{ color: colorPalette?.primary || '#7c3aed' }}>+ Add New City</option>
                      </select>
                      <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`} size={20} />
                    </div>
                  )}
                  {errors.cityId && <p className="text-red-500 text-xs mt-1">{errors.cityId}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                    }`}>
                    Barangay<span className="text-red-500">*</span>
                  </label>
                  {showNewBarangayInput ? (
                    <div className="relative">
                      <input
                        type="text"
                        value={newBarangayName}
                        onChange={(e) => setNewBarangayName(e.target.value)}
                        placeholder="Enter new barangay name"
                        className={`w-full px-3 py-2 border rounded focus:outline-none transition-all duration-200 ${isDarkMode
                          ? 'bg-gray-800 text-white'
                          : 'bg-white text-gray-900'
                          }`}
                        style={{
                          borderColor: colorPalette?.primary || '#7c3aed',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                          e.currentTarget.style.boxShadow = `0 0 0 2px ${colorPalette?.primary || '#7c3aed'}20`;
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          setShowNewBarangayInput(false);
                          setNewBarangayName('');
                        }}
                        className={isDarkMode ? 'absolute right-3 top-2.5 text-gray-400 hover:text-white' : 'absolute right-3 top-2.5 text-gray-600 hover:text-gray-900'}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={formData.barangayId?.toString() || ''}
                        onChange={(e) => handleBarangayChange(e.target.value)}
                        disabled={!formData.cityId && !showNewCityInput}
                        className={`w-full px-3 py-2 border rounded focus:outline-none appearance-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${errors.barangayId ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                          } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                          }`}
                        onFocus={(e) => {
                          if (!errors.barangayId) {
                            e.currentTarget.style.borderColor = colorPalette?.primary || '#7c3aed';
                            e.currentTarget.style.boxShadow = `0 0 0 2px ${colorPalette?.primary || '#7c3aed'}20`;
                          }
                        }}
                        onBlur={(e) => {
                          if (!errors.barangayId) {
                            e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
                            e.currentTarget.style.boxShadow = 'none';
                          }
                        }}
                      >
                        <option value="">Select Barangay</option>
                        {filteredBarangays.map(barangay => (
                          <option key={barangay.id} value={barangay.id}>{barangay.name}</option>
                        ))}
                        <option value="add_new" style={{ color: colorPalette?.primary || '#7c3aed' }}>+ Add New Barangay</option>
                      </select>
                      <ChevronDown className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`} size={20} />
                    </div>
                  )}
                  {errors.barangayId && <p className="text-red-500 text-xs mt-1">{errors.barangayId}</p>}
                </div>

              </>
            )}
          </div>
        </div>
      </div>

      <LoadingModalGlobal
        isOpen={globalModal.isOpen}
        type={globalModal.type}
        title={globalModal.title}
        message={globalModal.message}
        onConfirm={globalModal.onConfirm || closeGlobalModal}
        onCancel={closeGlobalModal}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />
    </>
  );
};

export default AddLocationModal;
