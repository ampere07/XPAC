import React, { useState, useEffect } from 'react';
import { Organization } from '../types/api';
import { organizationService } from '../services/userService';
import Breadcrumb from '../pages/Breadcrumb';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface AddNewOrganizationFormProps {
  onCancel: () => void;
  onOrganizationCreated: (organization: Organization) => void;
}

const AddNewOrganizationForm: React.FC<AddNewOrganizationFormProps> = ({ onCancel, onOrganizationCreated }) => {
  const [formData, setFormData] = useState({
    organization_name: '',
    address: '',
    contact_number: '',
    email_address: ''
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.organization_name?.trim()) {
      newErrors.organization_name = 'Organization name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateOrganization = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const dataToSend = {
        organization_name: formData.organization_name.trim(),
        address: formData.address.trim() || null,
        contact_number: formData.contact_number.trim() || null,
        email_address: formData.email_address.trim() || null
      };

      const response = await organizationService.createOrganization(dataToSend);

      if (response.success && response.data) {
        console.log('Organization creation response:', response.data);

        if (!response.data || typeof response.data !== 'object') {
          console.error('Invalid response data:', response.data);
          setErrors({ general: 'Failed to create organization. Please try again.' });
          return;
        }

        onOrganizationCreated(response.data);
        onCancel();
      } else {
        setErrors({ general: response.message || 'Failed to create organization' });
      }
    } catch (error: any) {
      console.error('Create organization error:', error);

      if (error.response?.status === 422) {
        if (error.response?.data?.errors) {
          const backendErrors: Record<string, string> = {};
          const errorData = error.response.data.errors;

          Object.keys(errorData).forEach(key => {
            if (Array.isArray(errorData[key])) {
              backendErrors[key] = errorData[key][0];
            } else {
              backendErrors[key] = errorData[key];
            }
          });

          setErrors(backendErrors);
        } else if (error.response?.data?.message) {
          setErrors({ general: error.response.data.message });
        } else {
          setErrors({ general: 'Validation error: Please check all required fields' });
        }
      } else {
        setErrors({
          general: error.response?.data?.message || error.message || 'Failed to create organization'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isDarkMode ? 'p-6' : 'p-6 bg-gray-50'}>
      <Breadcrumb items={[
        { label: 'Organizations', onClick: onCancel },
        { label: 'Add Organization' }
      ]} />
      <div className={`rounded-lg border overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-200 text-gray-900'
        }`}>
        <div className="p-6">
          <div className="mb-8">
            <h2 className={`text-2xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              Add New Organization
            </h2>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
              Create a new organization in the system
            </p>
          </div>

          {errors.general && (
            <div className={`mb-6 p-4 rounded ${isDarkMode
                ? 'bg-red-900 border border-red-600 text-red-200'
                : 'bg-red-100 border border-red-300 text-red-700'
              }`}>
              {errors.general}
            </div>
          )}

          <div className="max-w-2xl">
            <div className="grid grid-cols-1 gap-6">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Organization Name *
                </label>
                <input
                  type="text"
                  name="organization_name"
                  value={formData.organization_name}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.organization_name
                      ? 'border-red-600'
                      : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}
                  placeholder="Enter organization name"
                  required
                />
                {errors.organization_name && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.organization_name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Address
                </label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  rows={3}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.address
                      ? 'border-red-600'
                      : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}
                  placeholder="Enter organization address"
                />
                {errors.address && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.address}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Contact Number
                </label>
                <input
                  type="text"
                  name="contact_number"
                  value={formData.contact_number}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.contact_number
                      ? 'border-red-600'
                      : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}
                  placeholder="Enter contact number"
                />
                {errors.contact_number && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.contact_number}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  name="email_address"
                  value={formData.email_address}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.email_address
                      ? 'border-red-600'
                      : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}
                  placeholder="Enter email address"
                />
                {errors.email_address && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.email_address}</p>
                )}
              </div>
            </div>

            <div className="flex gap-4 mt-8">
              <button
                onClick={onCancel}
                disabled={loading}
                className={`px-6 py-3 border rounded transition-colors text-sm font-medium disabled:opacity-50 ${isDarkMode
                    ? 'border-gray-600 text-white hover:bg-gray-800'
                    : 'border-gray-300 text-gray-900 hover:bg-gray-100'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateOrganization}
                disabled={loading}
                className="px-6 py-3 rounded transition-colors text-sm font-medium disabled:opacity-50 text-white"
                style={{
                  backgroundColor: loading ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                }}
                onMouseEnter={(e) => {
                  if (!loading && colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                  }
                }}
              >
                {loading ? 'Creating...' : 'Create Organization'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddNewOrganizationForm;
