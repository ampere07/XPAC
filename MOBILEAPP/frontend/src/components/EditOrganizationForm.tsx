import React, { useState, useEffect } from 'react';
import { Organization } from '../types/api';
import { organizationService } from '../services/userService';
import Breadcrumb from '../pages/Breadcrumb';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface EditOrganizationFormProps {
  organization: Organization;
  onCancel: () => void;
  onOrganizationUpdated: (organization: Organization) => void;
}

const EditOrganizationForm: React.FC<EditOrganizationFormProps> = ({ organization, onCancel, onOrganizationUpdated }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [formData, setFormData] = useState({
    organization_name: organization?.organization_name || '',
    address: organization?.address || '',
    contact_number: organization?.contact_number || '',
    email_address: organization?.email_address || ''
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (organization) {
      setFormData({
        organization_name: organization.organization_name || '',
        address: organization.address || '',
        contact_number: organization.contact_number || '',
        email_address: organization.email_address || ''
      });
    }
  }, [organization]);

  if (!organization) {
    console.error('EditOrganizationForm received invalid organization data');
    return (
      <div className="p-6">
        <div className={`border rounded p-4 ${isDarkMode
            ? 'bg-red-900 border-red-600 text-red-200'
            : 'bg-red-100 border-red-300 text-red-800'
          }`}>
          <h3 className="text-lg font-semibold mb-2">Invalid Organization Data</h3>
          <p>Cannot edit organization: No organization data provided.</p>
          <button
            onClick={onCancel}
            className="mt-4 px-4 py-2 rounded transition-colors text-white"
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
            Back to Organizations
          </button>
        </div>
      </div>
    );
  }

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

  const handleUpdateOrganization = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const dataToSend: {
        organization_name?: string;
        address?: string | null;
        contact_number?: string | null;
        email_address?: string | null;
      } = {};

      if (formData.organization_name.trim() !== (organization.organization_name || '')) {
        dataToSend.organization_name = formData.organization_name.trim();
      }

      if (formData.address !== (organization.address || '')) {
        dataToSend.address = formData.address.trim() || null;
      }

      if (formData.contact_number !== (organization.contact_number || '')) {
        dataToSend.contact_number = formData.contact_number.trim() || null;
      }

      if (formData.email_address !== (organization.email_address || '')) {
        dataToSend.email_address = formData.email_address.trim() || null;
      }

      const response = await organizationService.updateOrganization(organization.id, dataToSend);

      if (response.success && response.data) {
        onOrganizationUpdated(response.data);
        onCancel();
      } else {
        setErrors({ general: response.message || 'Failed to update organization' });
      }
    } catch (error: any) {
      console.error('Update organization error:', error);

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
          general: error.response?.data?.message || error.message || 'Failed to update organization'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <Breadcrumb items={[
        { label: 'Organizations', onClick: onCancel },
        { label: 'Edit Organization' }
      ]} />
      <div className={`rounded-lg border overflow-hidden ${isDarkMode
          ? 'bg-gray-800 border-gray-600 text-white'
          : 'bg-white border-gray-300 text-gray-900'
        }`}>
        <div className="p-6">
          <div className="mb-8">
            <h2 className={`text-2xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              Edit Organization
            </h2>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
              Update organization information
            </p>
          </div>

          {errors.general && (
            <div className={`mb-6 p-4 border rounded ${isDarkMode
                ? 'bg-red-900 border-red-600 text-red-200'
                : 'bg-red-100 border-red-300 text-red-800'
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
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.organization_name
                      ? 'border-red-600'
                      : isDarkMode
                        ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                        : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter organization name"
                  required
                />
                {errors.organization_name && (
                  <p className="text-red-400 text-sm mt-1">{errors.organization_name}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Address
                </label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  rows={3}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.address
                      ? 'border-red-600'
                      : isDarkMode
                        ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                        : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter organization address"
                />
                {errors.address && (
                  <p className="text-red-400 text-sm mt-1">{errors.address}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Contact Number
                </label>
                <input
                  type="text"
                  name="contact_number"
                  value={formData.contact_number}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.contact_number
                      ? 'border-red-600'
                      : isDarkMode
                        ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                        : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter contact number"
                />
                {errors.contact_number && (
                  <p className="text-red-400 text-sm mt-1">{errors.contact_number}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Email Address
                </label>
                <input
                  type="email"
                  name="email_address"
                  value={formData.email_address}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.email_address
                      ? 'border-red-600'
                      : isDarkMode
                        ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                        : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter email address"
                />
                {errors.email_address && (
                  <p className="text-red-400 text-sm mt-1">{errors.email_address}</p>
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
                onClick={handleUpdateOrganization}
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
                {loading ? 'Updating...' : 'Update Organization'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditOrganizationForm;
