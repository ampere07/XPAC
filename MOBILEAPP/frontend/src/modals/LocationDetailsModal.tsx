import React, { useState } from 'react';
import { 
  X, Edit, Trash2,
  ChevronDown, ChevronUp
} from 'lucide-react';
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
}

interface LocationDetailsModalProps {
  isOpen: boolean;
  location: LocationItem | null;
  onClose: () => void;
  onEdit: (location: LocationItem) => void;
  onDelete: (location: LocationItem) => void;
}

const LocationDetailsModal: React.FC<LocationDetailsModalProps> = ({
  isOpen,
  location,
  onClose,
  onEdit,
  onDelete
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    relatedApplications: false,
    relatedServiceOrders: false
  });

  React.useEffect(() => {
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

  React.useEffect(() => {
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

  const handleEdit = () => {
    onEdit(location);
  };

  const handleDelete = () => {
    onDelete(location);
  };

  const toggleSection = (section: 'relatedApplications' | 'relatedServiceOrders') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
      <div className={`w-full max-w-2xl h-full flex flex-col overflow-hidden border-l animate-slide-in ${
        isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-4 py-3 flex items-center justify-between border-b ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
        }`}>
          <h2 className={`font-semibold text-xl ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
            {location.name}
          </h2>
          
          <div className="flex items-center space-x-2">
            <button 
              onClick={handleDelete}
              className={`p-2 rounded transition-colors ${
                isDarkMode 
                  ? 'text-gray-400 hover:text-white hover:bg-gray-700' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
              }`}
              title="Delete"
            >
              <Trash2 size={20} />
            </button>
            <button 
              onClick={handleEdit}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2 transition-colors"
            >
              <Edit size={18} />
              <span>Edit</span>
            </button>
            <button 
              onClick={onClose}
              className={`p-1 rounded transition-colors ${
                isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
              aria-label="Close"
            >
              <X size={22} />
            </button>
          </div>
        </div>
        
        {/* Location Details */}
        <div className={`flex-1 overflow-y-auto ${
          isDarkMode ? 'bg-gray-900' : 'bg-gray-50'
        }`}>
          <div className="p-6 space-y-6">
            {/* Name */}
            <div>
              <div className={`text-sm mb-1 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Name</div>
              <div className={`text-base ${
                isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{location.name}</div>
            </div>

            {/* Type */}
            <div>
              <div className={`text-sm mb-1 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>Type</div>
              <div className={`text-base ${
                isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{getLocationTypeLabel(location.type)}</div>
            </div>

            {/* Parent Information */}
            {location.parentName && (
              <div>
                <div className={`text-sm mb-1 ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {location.type === 'city' ? 'Region' : 
                   location.type === 'borough' ? 'City' : 
                   location.type === 'location' ? 'Barangay' : 'Parent'}
                </div>
                <div className={`text-base ${
                  isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{location.parentName}</div>
              </div>
            )}

            {/* ID */}
            <div>
              <div className={`text-sm mb-1 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>id</div>
              <div className={`text-base ${
                isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{location.id}</div>
            </div>

            {/* Additional IDs based on type */}
            {location.type === 'city' && location.parentId && (
              <div>
                <div className={`text-sm mb-1 ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>Region ID</div>
                <div className={`text-base ${
                  isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{location.parentId}</div>
              </div>
            )}

            {location.type === 'borough' && (
              <>
                {location.cityId && (
                  <div>
                    <div className={`text-sm mb-1 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>City ID</div>
                    <div className={`text-base ${
                      isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>{location.cityId}</div>
                  </div>
                )}
                {location.regionId && (
                  <div>
                    <div className={`text-sm mb-1 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>Region ID</div>
                    <div className={`text-base ${
                      isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>{location.regionId}</div>
                  </div>
                )}
              </>
            )}

            {location.type === 'location' && (
              <>
                {location.boroughId && (
                  <div>
                    <div className={`text-sm mb-1 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>Barangay ID</div>
                    <div className={`text-base ${
                      isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>{location.boroughId}</div>
                  </div>
                )}
                {location.cityId && (
                  <div>
                    <div className={`text-sm mb-1 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>City ID</div>
                    <div className={`text-base ${
                      isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}>{location.cityId}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Related Applications Section */}
          <div className={`border-t ${
            isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
            <div className={`px-4 py-3 flex items-center justify-between ${
              isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
            }`}>
              <div className="flex items-center space-x-2">
                <h3 className={`font-medium text-base ${
                  isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Related Applications</h3>
                <span className={`text-xs px-2 py-1 rounded ${
                  isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'
                }`}>0</span>
              </div>
              <button
                onClick={() => toggleSection('relatedApplications')}
                className={`transition-colors ${
                  isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {expandedSections.relatedApplications ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>

            {expandedSections.relatedApplications && (
              <div className={`p-4 ${
                isDarkMode ? 'bg-gray-900' : 'bg-white'
              }`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={`border-b ${
                        isDarkMode ? 'text-gray-400 border-gray-700' : 'text-gray-600 border-gray-200'
                      }`}>
                        <th className="text-left py-2 px-2">Customer Name</th>
                        <th className="text-left py-2 px-2">Address</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={4} className={`text-center py-8 ${
                          isDarkMode ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          No related applications found
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Related Service Orders Section */}
          <div className={`border-t ${
            isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
            <div className={`px-4 py-3 flex items-center justify-between ${
              isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
            }`}>
              <div className="flex items-center space-x-2">
                <h3 className={`font-medium text-base ${
                  isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Related Service Orders</h3>
                <span className={`text-xs px-2 py-1 rounded ${
                  isDarkMode ? 'bg-gray-600 text-white' : 'bg-gray-300 text-gray-900'
                }`}>0</span>
              </div>
              <button
                onClick={() => toggleSection('relatedServiceOrders')}
                className={`transition-colors ${
                  isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {expandedSections.relatedServiceOrders ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>

            {expandedSections.relatedServiceOrders && (
              <div className={`p-4 ${
                isDarkMode ? 'bg-gray-900' : 'bg-white'
              }`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={`border-b ${
                        isDarkMode ? 'text-gray-400 border-gray-700' : 'text-gray-600 border-gray-200'
                      }`}>
                        <th className="text-left py-2 px-2">Service Type</th>
                        <th className="text-left py-2 px-2">Customer</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={4} className={`text-center py-8 ${
                          isDarkMode ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          No related service orders found
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Expand Button */}
          <div className={`p-4 border-t ${
            isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'
          }`}>
            <button className="w-full text-red-500 hover:text-red-400 text-sm font-medium transition-colors">
              Expand
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocationDetailsModal;
