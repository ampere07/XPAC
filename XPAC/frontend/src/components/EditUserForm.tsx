import React, { useState, useEffect } from 'react';
import { User, UpdateUserRequest, Organization, Role } from '../types/api';
import { userService, organizationService, roleService } from '../services/userService';
import Breadcrumb from '../pages/Breadcrumb';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface EditUserFormProps {
  user: User;
  onCancel: () => void;
  onUserUpdated: (user: User) => void;
}

const salutationOptions = [
  { value: '', label: 'Select Salutation' },
  { value: 'Mr', label: 'Mr' },
  { value: 'Ms', label: 'Ms' },
  { value: 'Mrs', label: 'Mrs' },
  { value: 'Dr', label: 'Dr' },
  { value: 'Prof', label: 'Prof' }
];

const EditUserForm: React.FC<EditUserFormProps> = ({ user, onCancel, onUserUpdated }) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [formData, setFormData] = useState<UpdateUserRequest>({
    salutation: user?.salutation || '',
    first_name: user?.first_name || '',
    middle_initial: user?.middle_initial || '',
    last_name: user?.last_name || '',
    username: user?.username || '',
    email_address: user?.email_address || '',
    contact_number: user?.contact_number || '',
    organization_id: user?.organization_id,
    role_id: user?.role_id
  });

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
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
    loadOrganizations();
    loadRoles();
  }, []);

  useEffect(() => {
    if (user) {
      setFormData({
        salutation: user.salutation || '',
        first_name: user.first_name || '',
        middle_initial: user.middle_initial || '',
        last_name: user.last_name || '',
        username: user.username || '',
        email_address: user.email_address || '',
        contact_number: user.contact_number || '',
        organization_id: user.organization_id,
        role_id: user.role_id
      });
    }
  }, [user]);

  if (!user) {
    console.error('EditUserForm received invalid user data');
    return (
      <div className="p-6">
        <div className={`border rounded p-4 ${isDarkMode
          ? 'bg-red-900 border-red-600 text-red-200'
          : 'bg-red-100 border-red-300 text-red-800'
          }`}>
          <h3 className="text-lg font-semibold mb-2">Invalid User Data</h3>
          <p>Cannot edit user: No user data provided.</p>
          <button
            onClick={onCancel}
            className={`mt-4 px-4 py-2 rounded transition-colors ${isDarkMode
              ? 'bg-gray-600 hover:bg-gray-700 text-white'
              : 'bg-gray-300 hover:bg-gray-400 text-gray-900'
              }`}
          >
            Back to Users
          </button>
        </div>
      </div>
    );
  }

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

  const loadRoles = async () => {
    try {
      const response = await roleService.getAllRoles();
      if (response.success && response.data) {
        setRoles(response.data);
      }
    } catch (error) {
      console.error('Failed to load roles:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'organization_id' || name === 'role_id') {
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

    if (!formData.first_name?.trim()) {
      newErrors.first_name = 'First name is required';
    }

    if (!formData.last_name?.trim()) {
      newErrors.last_name = 'Last name is required';
    }

    if (!formData.username?.trim()) {
      newErrors.username = 'Username is required';
    } else if (formData.username.length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    }

    if (!formData.email_address?.trim()) {
      newErrors.email_address = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email_address)) {
      newErrors.email_address = 'Please enter a valid email address';
    }

    if (formData.password && formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (formData.contact_number && formData.contact_number.trim() && !/^[+]?[0-9\s\-\(\)]+$/.test(formData.contact_number)) {
      newErrors.contact_number = 'Contact number format is invalid';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUpdateUser = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const dataToSend: UpdateUserRequest = {};

      if (formData.salutation !== undefined && formData.salutation !== (user.salutation || '')) {
        dataToSend.salutation = formData.salutation.trim() || undefined;
      }

      if (formData.first_name && formData.first_name.trim() !== (user.first_name || '')) {
        dataToSend.first_name = formData.first_name.trim();
      }

      if (formData.middle_initial !== (user.middle_initial || '')) {
        dataToSend.middle_initial = formData.middle_initial?.trim() || undefined;
      }

      if (formData.last_name && formData.last_name.trim() !== (user.last_name || '')) {
        dataToSend.last_name = formData.last_name.trim();
      }

      if (formData.username && formData.username.trim() !== (user.username || '')) {
        dataToSend.username = formData.username.trim();
      }

      if (formData.email_address && formData.email_address.trim() !== (user.email_address || '')) {
        dataToSend.email_address = formData.email_address.trim();
      }

      if (formData.contact_number !== (user.contact_number || '')) {
        dataToSend.contact_number = formData.contact_number?.trim() || undefined;
      }

      const currentOrgId = user.organization_id || undefined;
      const newOrgId = formData.organization_id || undefined;

      if (newOrgId !== currentOrgId) {
        dataToSend.organization_id = (formData.organization_id && formData.organization_id > 0) ? formData.organization_id : undefined;
      }

      const currentRoleId = user.role_id || undefined;
      const newRoleId = formData.role_id || undefined;

      if (newRoleId !== currentRoleId) {
        dataToSend.role_id = (formData.role_id && formData.role_id > 0) ? formData.role_id : undefined;
      }

      if (formData.password && formData.password.trim()) {
        dataToSend.password = formData.password;
      }

      const response = await userService.updateUser(user.id, dataToSend);

      if (response.success && response.data) {
        onUserUpdated(response.data);
        onCancel();
      } else {
        setErrors({ general: response.message || 'Failed to update user' });
      }
    } catch (error: any) {
      console.error('Update user error:', error);

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
          general: error.response?.data?.message || error.message || 'Failed to update user'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <Breadcrumb items={[
        { label: 'Users', onClick: onCancel },
        { label: 'Edit User' }
      ]} />
      <div className={`rounded-lg border overflow-hidden ${isDarkMode
        ? 'bg-gray-800 border-gray-600 text-white'
        : 'bg-white border-gray-300 text-gray-900'
        }`}>
        <div className="p-6">
          <div className="mb-8">
            <h2 className={`text-2xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              Edit User
            </h2>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
              Update user information
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Salutation
                </label>
                <select
                  name="salutation"
                  value={formData.salutation || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                >
                  {salutationOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  First Name *
                </label>
                <input
                  type="text"
                  name="first_name"
                  value={formData.first_name || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.first_name
                    ? 'border-red-600'
                    : isDarkMode
                      ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter first name"
                  required
                />
                {errors.first_name && (
                  <p className="text-red-400 text-sm mt-1">{errors.first_name}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Middle Initial
                </label>
                <input
                  type="text"
                  name="middle_initial"
                  value={formData.middle_initial || ''}
                  onChange={handleInputChange}
                  maxLength={1}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="M"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Last Name *
                </label>
                <input
                  type="text"
                  name="last_name"
                  value={formData.last_name || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.last_name
                    ? 'border-red-600'
                    : isDarkMode
                      ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter last name"
                  required
                />
                {errors.last_name && (
                  <p className="text-red-400 text-sm mt-1">{errors.last_name}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Username *
                </label>
                <input
                  type="text"
                  name="username"
                  value={formData.username || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.username
                    ? 'border-red-600'
                    : isDarkMode
                      ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter username"
                  required
                />
                {errors.username && (
                  <p className="text-red-400 text-sm mt-1">{errors.username}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Email *
                </label>
                <input
                  type="email"
                  name="email_address"
                  value={formData.email_address || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.email_address
                    ? 'border-red-600'
                    : isDarkMode
                      ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Enter email address"
                  required
                />
                {errors.email_address && (
                  <p className="text-red-400 text-sm mt-1">{errors.email_address}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Contact Number
                </label>
                <input
                  type="tel"
                  name="contact_number"
                  value={formData.contact_number || ''}
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
                  Organization (Optional)
                </label>
                <select
                  name="organization_id"
                  value={formData.organization_id || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
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
                  Role (Optional)
                </label>
                <select
                  name="role_id"
                  value={formData.role_id || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                >
                  <option value="">No Role</option>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.role_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  New Password (optional)
                </label>
                <input
                  type="password"
                  name="password"
                  value={formData.password || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border rounded placeholder-gray-500 focus:outline-none ${errors.password
                    ? 'border-red-600'
                    : isDarkMode
                      ? 'bg-gray-900 border-gray-600 text-white focus:border-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    }`}
                  placeholder="Leave blank to keep current password"
                />
                {errors.password && (
                  <p className="text-red-400 text-sm mt-1">{errors.password}</p>
                )}
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                  Leave blank to keep current password. Minimum 8 characters if changing.
                </p>
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
                onClick={handleUpdateUser}
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
                {loading ? 'Updating...' : 'Update User'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditUserForm;
