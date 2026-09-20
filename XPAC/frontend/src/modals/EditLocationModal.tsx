import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface LocationItem {
  id: number;
  name: string;
  type: 'city' | 'region' | 'borough' | 'location';
  parentId?: number;
  parentName?: string;
  cityId?: number;
  regionId?: number;
  boroughId?: number;
  organization_id?: number | null;
}

interface EditLocationModalProps {
  isOpen: boolean;
  location: LocationItem | null;
  allLocations?: LocationItem[];
  onClose: () => void;
  onEdit: (location: LocationItem) => void;
  onDelete: (location: LocationItem) => void;
  onSelectLocation?: (location: LocationItem) => void;
}

const EditLocationModal: React.FC<EditLocationModalProps> = ({
  isOpen,
  location,
  allLocations = [],
  onClose,
  onEdit,
  onDelete,
  onSelectLocation
}) => {
  const [editedName, setEditedName] = useState('');
  const [barangayName, setBarangayName] = useState('');
  const [cityName, setCityName] = useState('');
  const [regionName, setRegionName] = useState('');
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

  // Populate the editable name ONLY when the target location (by id) changes or the
  // modal opens — never when allLocations changes. Previously this lived in the effect
  // below (which depends on allLocations): every keystroke re-renders, hands us a new
  // allLocations reference, re-runs the effect, and reset the input back to location.name.
  useEffect(() => {
    if (location && isOpen) {
      setEditedName(location.name);
    }
  }, [location?.id, isOpen]);

  useEffect(() => {
    if (location && isOpen) {
      console.log('=== EDIT LOCATION MODAL DEBUG ===');
      console.log('Location data:', location);
      console.log('All locations count:', allLocations.length);
      console.log('All locations:', allLocations);

      // For locations, get the barangay, city, and region names from allLocations
      if (location.type === 'location') {
        console.log('--- Location Lookup ---');
        console.log('Location boroughId:', location.boroughId);
        console.log('Location parentId:', location.parentId);

        // Get Barangay name
        if (location.boroughId || location.parentId) {
          const barangayId = location.boroughId || location.parentId;
          console.log('Looking for barangay with ID:', barangayId);

          const barangay = allLocations.find(loc => {
            console.log(`Checking location: type=${loc.type}, id=${loc.id}`);
            return loc.type === 'borough' && loc.id === barangayId;
          });

          console.log('Found barangay:', barangay);

          if (barangay) {
            setBarangayName(barangay.name);
            console.log('Set barangay name to:', barangay.name);

            // Get City name using barangay's cityId
            if (barangay.cityId) {
              console.log('Looking for city with ID:', barangay.cityId);
              const city = allLocations.find(loc => loc.type === 'city' && loc.id === barangay.cityId);
              console.log('Found city:', city);

              if (city) {
                setCityName(city.name);
                console.log('Set city name to:', city.name);

                // Get Region name using city's regionId
                if (city.regionId) {
                  console.log('Looking for region with ID:', city.regionId);
                  const region = allLocations.find(loc => loc.type === 'region' && loc.id === city.regionId);
                  console.log('Found region:', region);

                  if (region) {
                    setRegionName(region.name);
                    console.log('Set region name to:', region.name);
                  }
                }
              }
            }
          }
        }

        // Alternative: use parentName if available
        if (!barangayName && location.parentName) {
          console.log('Using parentName for barangay:', location.parentName);
          setBarangayName(location.parentName);
        }

        // Alternative: use direct cityId if available
        if (!cityName && location.cityId) {
          console.log('Using direct cityId:', location.cityId);
          const city = allLocations.find(loc => loc.type === 'city' && loc.id === location.cityId);
          if (city) {
            setCityName(city.name);
          }
        }

        // Alternative: use direct regionId if available
        if (!regionName && location.regionId) {
          console.log('Using direct regionId:', location.regionId);
          const region = allLocations.find(loc => loc.type === 'region' && loc.id === location.regionId);
          if (region) {
            setRegionName(region.name);
          }
        }
      }

      console.log('=== END DEBUG ===');
    }
  }, [location, isOpen, allLocations]);

  if (!isOpen || !location) return null;

  const getLocationTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      city: 'City',
      region: 'Region',
      borough: 'Barangay',
      location: 'Location'
    };
    return labels[type] || type;
  };

  const handleSave = () => {
    const updatedLocation: LocationItem = { ...location, name: editedName };
    onEdit(updatedLocation);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 flex flex-col overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-white'
        }`}>
        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between border-b flex-shrink-0 ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-gray-100 border-gray-300'
          }`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Edit {getLocationTypeLabel(location.type)}</h2>
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-white rounded text-sm transition-colors"
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
              Save
            </button>
            <button
              onClick={onClose}
              className={isDarkMode ? 'text-gray-400 hover:text-white transition-colors' : 'text-gray-600 hover:text-gray-900 transition-colors'}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl space-y-6">
            {/* Name Field */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                  }`}
              />
            </div>

            {/* Barangay Field (for Locations) */}
            {location.type === 'location' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Barangay<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={barangayName}
                  disabled
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-500'
                      : 'bg-gray-100 border-gray-300 text-gray-500'
                    }`}
                />
              </div>
            )}

            {/* City Field (for Locations) */}
            {location.type === 'location' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  City<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={cityName}
                  disabled
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-500'
                      : 'bg-gray-100 border-gray-300 text-gray-500'
                    }`}
                />
              </div>
            )}

            {/* Region Field (for Locations) */}
            {location.type === 'location' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Region<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={regionName}
                  disabled
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-500'
                      : 'bg-gray-100 border-gray-300 text-gray-500'
                    }`}
                />
              </div>
            )}

            {/* Parent Field (for City and Barangay) */}
            {location.type !== 'location' && location.type !== 'region' && location.parentName && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  {location.type === 'city' ? 'Region' :
                    location.type === 'borough' ? 'City' : 'Parent'}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={location.parentName}
                  disabled
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-500'
                      : 'bg-gray-100 border-gray-300 text-gray-500'
                    }`}
                />
              </div>
            )}

            {/* ID Field */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                id<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={location.id}
                disabled
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-gray-500'
                    : 'bg-gray-100 border-gray-300 text-gray-500'
                  }`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditLocationModal;
