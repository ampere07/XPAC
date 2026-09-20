import React, { useState, useEffect } from 'react';
import { User, CreateUserRequest, Role } from '../types/api';
import { userService, roleService } from '../services/userService';
import Breadcrumb from '../pages/Breadcrumb';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { Eye, EyeOff } from 'lucide-react';

interface AddNewUserFormProps {
  onCancel: () => void;
  onUserCreated: (user: User) => void;
}

const AddNewUserForm: React.FC<AddNewUserFormProps> = ({ onCancel, onUserCreated }) => {
  const initialFormData: CreateUserRequest = {
    first_name: '',
    middle_initial: '',
    last_name: '',
    username: '',
    email_address: '',
    contact_number: '',
    password: '',
    role_id: undefined
  };

  const [formData, setFormData] = useState<CreateUserRequest>(initialFormData);

  const [confirmPassword, setConfirmPassword] = useState('');
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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
    loadRoles();
  }, []);


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

    if (name === 'confirmPassword') {
      setConfirmPassword(value);
    } else if (name === 'role_id') {
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

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (formData.password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.role_id) {
      newErrors.role_id = 'Role is required';
    }

    if (formData.contact_number && formData.contact_number.trim() && !/^[+]?[0-9\s\-\(\)]+$/.test(formData.contact_number)) {
      newErrors.contact_number = 'Contact number format is invalid';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateUser = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      let userId = null;
      try {
        const authDataStr = localStorage.getItem('authData');
        if (authDataStr) {
          const authData = JSON.parse(authDataStr);
          userId = authData.id || authData.user?.id || null;
        }
      } catch (e) {
        console.error('Failed to parse authData', e);
      }

      const dataToSend: CreateUserRequest = {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        username: formData.username.trim().toLowerCase(),
        email_address: formData.email_address.trim().toLowerCase(),
        password: formData.password,
        darkmode: 'inactive',
        created_by_user_id: userId,
        updated_by_user_id: userId,
      };

      if (formData.middle_initial && formData.middle_initial.trim()) {
        dataToSend.middle_initial = formData.middle_initial.trim();
      }

      if (formData.contact_number && formData.contact_number.trim()) {
        dataToSend.contact_number = formData.contact_number.trim();
      }


      if (formData.role_id && formData.role_id > 0) {
        dataToSend.role_id = formData.role_id;
      }

      const response = await userService.createUser(dataToSend);

      if (response.success && response.data) {
        onUserCreated(response.data);
        setFormData(initialFormData);
        setConfirmPassword('');
        onCancel();
      } else {
        setErrors({ general: response.message || 'Failed to create user' });
      }
    } catch (error: any) {
      console.error('Failed to create user');

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
          general: error.response?.data?.message || error.message || 'Failed to create user'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isDarkMode ? 'p-6' : 'p-6 bg-gray-50'}>
      <Breadcrumb items={[
        { label: 'Users', onClick: onCancel },
        { label: 'Add User' }
      ]} />
      <div className={`rounded-lg border overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-200 text-gray-900'
        }`}>
        <div className="p-6">
          <div className="mb-8">
            <h2 className={`text-2xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              Add New User
            </h2>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>
              Create a new user account in the system
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


              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  First Name *
                </label>
                <input
                  type="text"
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.first_name ? 'border-red-600' : ''}`}
                  placeholder="Enter first name"
                  required
                />
                {errors.first_name && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.first_name}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Middle Initial
                </label>
                <input
                  type="text"
                  name="middle_initial"
                  value={formData.middle_initial}
                  onChange={handleInputChange}
                  maxLength={1}
                  className={`w-full px-4 py-3 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    }`}
                  placeholder="M"
                />
                {errors.middle_initial && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.middle_initial}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Last Name *
                </label>
                <input
                  type="text"
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.last_name ? 'border-red-600' : ''}`}
                  placeholder="Enter last name"
                  required
                />
                {errors.last_name && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.last_name}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Username *
                </label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.username ? 'border-red-600' : ''}`}
                  placeholder="Enter username"
                  required
                />
                {errors.username && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.username}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Email *
                </label>
                <input
                  type="email"
                  name="email_address"
                  value={formData.email_address}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.email_address ? 'border-red-600' : ''}`}
                  placeholder="Enter email address"
                  required
                />
                {errors.email_address && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.email_address}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Contact Number
                </label>
                <input
                  type="tel"
                  name="contact_number"
                  value={formData.contact_number}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                    } ${errors.contact_number ? 'border-red-600' : ''}`}
                  placeholder="Enter contact number"
                />
                {errors.contact_number && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.contact_number}</p>
                )}
              </div>


              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Role *
                </label>
                <select
                  name="role_id"
                  value={formData.role_id || ''}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 rounded border focus:outline-none ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-white focus:border-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 focus:border-gray-500'
                    } ${errors.role_id ? 'border-red-600' : ''}`}
                >
                  <option value="">Select Role</option>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.role_name}
                    </option>
                  ))}
                </select>
                {errors.role_id && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.role_id}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Password *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className={`w-full px-4 py-3 pr-12 rounded border focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                      } ${errors.password ? 'border-red-600' : ''}`}
                    placeholder="Enter password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-4 top-1/2 -translate-y-1/2 focus:outline-none hover:opacity-70 transition-opacity ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.password && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.password}</p>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Confirm Password *
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    value={confirmPassword}
                    onChange={handleInputChange}
                    className={`w-full px-4 py-3 pr-12 rounded border focus:outline-none ${isDarkMode
                      ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-gray-400'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
                      } ${errors.confirmPassword ? 'border-red-600' : ''}`}
                    placeholder="Confirm password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className={`absolute right-4 top-1/2 -translate-y-1/2 focus:outline-none hover:opacity-70 transition-opacity ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}
                  >
                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errors.confirmPassword}</p>
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
                onClick={handleCreateUser}
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
                {loading ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddNewUserForm;
