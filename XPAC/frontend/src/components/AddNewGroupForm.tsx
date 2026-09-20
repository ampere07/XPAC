import React, { useState, useEffect } from 'react';
import { Group, Organization } from '../types/api';
import { groupService, organizationService } from '../services/userService';
import Breadcrumb from '../pages/Breadcrumb';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface AddNewGroupFormProps {
  onCancel: () => void;
  onGroupCreated: (group: Group) => void;
}

const AddNewGroupForm: React.FC<AddNewGroupFormProps> = ({ onCancel, onGroupCreated }) => {
  const [formData, setFormData] = useState({
    group_name: '',
    fb_page_link: '',
    fb_messenger_link: '',
    template: '',
    company_name: '',
    portal_url: '',
    hotline: '',
    email: '',
    org_id: undefined as number | undefined
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [organizations, setOrganizations] = useState<Organization[]>([]);
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

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      const response = await organizationService.getAllOrganizations();
      if (response.success && response.data) {
        setOrganizations(response.data);
      }
    } catch (error) {
      console.error('Failed to load organizations:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'org_id') {
      const numericValue = value && value !== '' ? parseInt(value, 10) : undefined;
      setFormData(prev => ({
        ...prev,
        [name]: numericValue
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.group_name?.trim()) {
      newErrors.group_name = 'Affiliate name is required';
    }

    if (formData.email && formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateGroup = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const dataToSend = {
        group_name: formData.group_name.trim(),
        fb_page_link: formData.fb_page_link.trim() || null,
        fb_messenger_link: formData.fb_messenger_link.trim() || null,
        template: formData.template.trim() || null,
        company_name: formData.company_name.trim() || null,
        portal_url: formData.portal_url.trim() || null,
        hotline: formData.hotline.trim() || null,
        email: formData.email.trim() || null,
        org_id: formData.org_id && formData.org_id > 0 ? formData.org_id : null
      };

      const response = await groupService.createGroup(dataToSend);

      if (response.success && response.data) {
        console.log('Affiliate creation response:', response.data);

        if (!response.data || typeof response.data !== 'object') {
          console.error('Invalid response data:', response.data);
          setErrors({ general: 'Failed to create Affiliate. Please try again.' });
          return;
        }

        onGroupCreated(response.data);
        onCancel();
      } else {
        setErrors({ general: response.message || 'Failed to create Affiliate' });
      }
    } catch (error: any) {
      console.error('Create Affiliate error:', error);

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
          general: error.response?.data?.message || error.message || 'Failed to create Affiliate'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isDarkMode ? 'p-6' : 'p-6 bg-gray-50'}>
      <Breadcrumb items={[
        { label: 'Affiliate', onClick: onCancel },
        { label: 'Add Affiliate' }
      ]} />
      <div className={`rounded-lg border overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-200 text-gray-900'
        }`}>
        <div className="p-6">
          <div className="mb-8">
            <h2 className={`text-2xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              Add New Affiliate
            </h2>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
              Create a new Affiliate in the system
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Affiliate Name *
                </label>
                <input
                  type="text"
                  name="group_name"
                  value={formData.group_name}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.group_name
                      ? 'border-red-600'
                      : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}
                  placeholder="Enter Affiliate name"
                  required
                />
                {errors.group_name && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.group_name}</p>
                )}
              </div>

              <div className="md:col-span-2">
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Organization (Optional)
                </label>
                <select
                  name="org_id"
                  value={formData.org_id || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 border border-gray-600 text-white focus:border-gray-400'
                      : 'bg-white border border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                >
                  <option value="">No Organization</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.organization_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Company Name
                </label>
                <input
                  type="text"
                  name="company_name"
                  value={formData.company_name}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.company_name
                      ? 'border-red-600'
                      : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}
                  placeholder="Enter company name"
                />
                {errors.company_name && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.company_name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 bg-gray-900 border rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 ${errors.email ? 'border-red-600' : 'border-gray-600'
                    }`}
                  placeholder="Enter email address"
                />
                {errors.email && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Hotline
                </label>
                <input
                  type="text"
                  name="hotline"
                  value={formData.hotline}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 bg-gray-900 border rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 ${errors.hotline ? 'border-red-600' : 'border-gray-600'
                    }`}
                  placeholder="Enter hotline number"
                />
                {errors.hotline && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.hotline}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Portal URL
                </label>
                <input
                  type="url"
                  name="portal_url"
                  value={formData.portal_url}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 bg-gray-900 border rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 ${errors.portal_url ? 'border-red-600' : 'border-gray-600'
                    }`}
                  placeholder="Enter portal URL"
                />
                {errors.portal_url && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.portal_url}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Facebook Page Link
                </label>
                <input
                  type="url"
                  name="fb_page_link"
                  value={formData.fb_page_link}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 bg-gray-900 border rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 ${errors.fb_page_link ? 'border-red-600' : 'border-gray-600'
                    }`}
                  placeholder="Enter Facebook page link"
                />
                {errors.fb_page_link && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.fb_page_link}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Facebook Messenger Link
                </label>
                <input
                  type="url"
                  name="fb_messenger_link"
                  value={formData.fb_messenger_link}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 bg-gray-900 border rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 ${errors.fb_messenger_link ? 'border-red-600' : 'border-gray-600'
                    }`}
                  placeholder="Enter Facebook Messenger link"
                />
                {errors.fb_messenger_link && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.fb_messenger_link}</p>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Template
                </label>
                <textarea
                  name="template"
                  value={formData.template}
                  onChange={handleInputChange}
                  rows={3}
                  className={`w-full px-4 py-3 rounded focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.template
                      ? 'border-red-600'
                      : isDarkMode ? 'border-gray-600' : 'border-gray-300'
                    }`}
                  placeholder="Enter template content"
                />
                {errors.template && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>{errors.template}</p>
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
                onClick={handleCreateGroup}
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
                {loading ? 'Creating...' : 'Create Affiliate'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddNewGroupForm;
