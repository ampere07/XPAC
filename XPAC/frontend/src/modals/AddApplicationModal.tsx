import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import { referredByEcho } from '../utils/referredByField';

interface AddApplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingApplication?: ApplicationData | null;
}

interface ApplicationData {
  id?: string;
  first_name: string;
  middle_initial?: string;
  last_name: string;
  email_address: string;
  mobile_number: string;
  secondary_mobile_number?: string;
  installation_address: string;
  landmark?: string;
  region?: string;
  city?: string;
  barangay?: string;
  location?: string;
  desired_plan: string;
  promo?: string;
  referred_by?: string;
  status: string;
  terms_and_conditions: boolean;
  government_valid_id?: string;
}

const AddApplicationModal: React.FC<AddApplicationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingApplication
}) => {
  const [formData, setFormData] = useState<ApplicationData>({
    first_name: '',
    middle_initial: '',
    last_name: '',
    email_address: '',
    mobile_number: '',
    secondary_mobile_number: '',
    installation_address: '',
    landmark: '',
    region: '',
    city: '',
    barangay: '',
    location: '',
    desired_plan: '',
    promo: '',
    referred_by: '',
    status: 'pending',
    terms_and_conditions: false,
    government_valid_id: ''
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  // The agent roster, so a name typed into the box below can be stored as that
  // agent's id rather than as the text. Free text that matches nobody — a team
  // name, "Walk in" — is stored exactly as typed, which is most of this column.
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const fetchAgents = async () => {
      try {
        const response = await userService.getUsersByRole('agent');
        if (cancelled) return;
        if (response.success && response.data) {
          setAgents(response.data);
          return;
        }
        const byId = await userService.getUsersByRoleId(4);
        if (!cancelled && byId.success && byId.data) setAgents(byId.data);
      } catch {
        // A roster that will not load only costs the name-to-id upgrade; the
        // typed text is still stored, which is what happened before it existed.
        if (!cancelled) setAgents([]);
      }
    };

    fetchAgents();
    return () => { cancelled = true; };
  }, [isOpen]);

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

  const statusOptions = [
    { value: 'pending', label: 'Pending', color: 'text-orange-400' },
    { value: 'schedule', label: 'Scheduled', color: 'text-green-400' },
    { value: 'no facility', label: 'No Facility', color: 'text-red-400' },
    { value: 'cancelled', label: 'Cancelled', color: 'text-red-500' },
    { value: 'no slot', label: 'No Slot', color: 'text-yellow-400' },
    { value: 'duplicate', label: 'Duplicate', color: 'text-yellow-500' },
    { value: 'in progress', label: 'In Progress', color: 'text-blue-400' },
    { value: 'completed', label: 'Completed', color: 'text-green-400' }
  ];

  useEffect(() => {
    if (isOpen && editingApplication) {
      setFormData({
        first_name: editingApplication.first_name || '',
        middle_initial: editingApplication.middle_initial || '',
        last_name: editingApplication.last_name || '',
        email_address: editingApplication.email_address || '',
        mobile_number: editingApplication.mobile_number || '',
        secondary_mobile_number: editingApplication.secondary_mobile_number || '',
        installation_address: editingApplication.installation_address || '',
        landmark: editingApplication.landmark || '',
        region: editingApplication.region || '',
        city: editingApplication.city || '',
        barangay: editingApplication.barangay || '',
        location: editingApplication.location || '',
        desired_plan: editingApplication.desired_plan || '',
        promo: editingApplication.promo || '',
        referred_by: editingApplication.referred_by || '',
        status: editingApplication.status || 'pending',
        terms_and_conditions: editingApplication.terms_and_conditions || false,
        government_valid_id: editingApplication.government_valid_id || ''
      });
    } else if (isOpen && !editingApplication) {
      resetForm();
    }
  }, [isOpen, editingApplication]);

  const resetForm = () => {
    setFormData({
      first_name: '',
      middle_initial: '',
      last_name: '',
      email_address: '',
      mobile_number: '',
      secondary_mobile_number: '',
      installation_address: '',
      landmark: '',
      region: '',
      city: '',
      barangay: '',
      location: '',
      desired_plan: '',
      promo: '',
      referred_by: '',
      status: 'pending',
      terms_and_conditions: false,
      government_valid_id: ''
    });
    setErrors({});
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.first_name.trim()) {
      newErrors.first_name = 'First name is required';
    }

    if (!formData.last_name.trim()) {
      newErrors.last_name = 'Last name is required';
    }

    if (!formData.email_address.trim()) {
      newErrors.email_address = 'Email address is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email_address)) {
      newErrors.email_address = 'Invalid email address format';
    }

    if (!formData.mobile_number.trim()) {
      newErrors.mobile_number = 'Mobile number is required';
    } else if (!/^[0-9]{10,11}$/.test(formData.mobile_number)) {
      newErrors.mobile_number = 'Mobile number must be 10-11 digits';
    }

    if (formData.secondary_mobile_number && !/^[0-9]{10,11}$/.test(formData.secondary_mobile_number)) {
      newErrors.secondary_mobile_number = 'Secondary mobile number must be 10-11 digits';
    }

    if (!formData.installation_address.trim()) {
      newErrors.installation_address = 'Installation address is required';
    }

    if (!formData.desired_plan.trim()) {
      newErrors.desired_plan = 'Desired plan is required';
    }

    if (!formData.terms_and_conditions) {
      newErrors.terms_and_conditions = 'You must agree to the terms and conditions';
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
      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;

      const payload = {
        first_name: formData.first_name.trim(),
        middle_initial: formData.middle_initial?.trim() || '',
        last_name: formData.last_name.trim(),
        email_address: formData.email_address.trim(),
        mobile_number: formData.mobile_number.trim(),
        secondary_mobile_number: formData.secondary_mobile_number?.trim() || '',
        installation_address: formData.installation_address.trim(),
        landmark: formData.landmark?.trim() || '',
        region: formData.region?.trim() || '',
        city: formData.city?.trim() || '',
        barangay: formData.barangay?.trim() || '',
        location: formData.location?.trim() || '',
        desired_plan: formData.desired_plan.trim(),
        promo: formData.promo?.trim() || '',
        // Untouched, this writes back the id the record was loaded with; typed
        // over, a name belonging to one agent becomes their id and anything
        // else is stored as it reads.
        referred_by: referredByEcho(editingApplication, formData.referred_by || '', agents) || '',
        status: formData.status,
        terms_and_conditions: formData.terms_and_conditions,
        government_valid_id: formData.government_valid_id?.trim() || '',
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      // Routed through apiClient so the session cookie and CSRF token are attached —
      // the /applications endpoints sit behind auth:sanctum.
      const path = editingApplication
        ? `/applications/${editingApplication.id}`
        : '/applications';

      type SaveResponse = { success?: boolean; message?: string; errors?: Record<string, string[]> };

      const response = editingApplication
        ? await apiClient.put<SaveResponse>(path, payload)
        : await apiClient.post<SaveResponse>(path, payload);

      const data = response.data;

      if (data?.success) {
        alert(data.message || `Application ${editingApplication ? 'updated' : 'created'} successfully`);
        onSave();
        handleClose();
      } else {
        alert(data?.message || `Failed to ${editingApplication ? 'update' : 'create'} application`);
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      const data = error?.response?.data;
      if (data?.errors) {
        const errorMessages = Object.values(data.errors).flat().join('\n');
        alert('Validation errors:\n' + errorMessages);
      } else {
        alert(
          data?.message ||
          `Failed to ${editingApplication ? 'update' : 'create'} application: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50" onClick={handleClose}>
      <div
        className={`h-full w-full md:w-full md:max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-300'
          }`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{editingApplication ? 'Edit Application' : 'New Application'}</h2>
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
              Status<span className="text-red-500">*</span>
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
            >
              {statusOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                First Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.first_name ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
                placeholder="Enter first name"
              />
              {errors.first_name && <p className="text-red-500 text-xs mt-1">{errors.first_name}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                M.I.
              </label>
              <input
                type="text"
                maxLength={2}
                value={formData.middle_initial}
                onChange={(e) => setFormData({ ...formData, middle_initial: e.target.value })}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
                placeholder="M.I."
              />
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Last Name<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.last_name ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
              placeholder="Enter last name"
            />
            {errors.last_name && <p className="text-red-500 text-xs mt-1">{errors.last_name}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Email Address<span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={formData.email_address}
              onChange={(e) => setFormData({ ...formData, email_address: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.email_address ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
              placeholder="example@email.com"
            />
            {errors.email_address && <p className="text-red-500 text-xs mt-1">{errors.email_address}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Mobile Number<span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={formData.mobile_number}
              onChange={(e) => setFormData({ ...formData, mobile_number: e.target.value.replace(/\D/g, '') })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.mobile_number ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
              placeholder="09123456789"
              maxLength={11}
            />
            {errors.mobile_number && <p className="text-red-500 text-xs mt-1">{errors.mobile_number}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Second Mobile Number
            </label>
            <input
              type="tel"
              value={formData.secondary_mobile_number}
              onChange={(e) => setFormData({ ...formData, secondary_mobile_number: e.target.value.replace(/\D/g, '') })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.secondary_mobile_number ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
              placeholder="09123456789"
              maxLength={11}
            />
            {errors.secondary_mobile_number && <p className="text-red-500 text-xs mt-1">{errors.secondary_mobile_number}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Installation Address<span className="text-red-500">*</span>
            </label>
            <textarea
              value={formData.installation_address}
              onChange={(e) => setFormData({ ...formData, installation_address: e.target.value })}
              rows={3}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${errors.installation_address ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
              placeholder="Enter full installation address"
            />
            {errors.installation_address && <p className="text-red-500 text-xs mt-1">{errors.installation_address}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Landmark
            </label>
            <input
              type="text"
              value={formData.landmark}
              onChange={(e) => setFormData({ ...formData, landmark: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
              placeholder="Nearby landmark"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Region
              </label>
              <input
                type="text"
                value={formData.region}
                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
                placeholder="Region"
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                City
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
                placeholder="City"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Barangay
              </label>
              <input
                type="text"
                value={formData.barangay}
                onChange={(e) => setFormData({ ...formData, barangay: e.target.value })}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
                placeholder="Barangay"
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Location
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
                placeholder="Specific location"
              />
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Desired Plan<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.desired_plan}
              onChange={(e) => setFormData({ ...formData, desired_plan: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.desired_plan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
              placeholder="e.g., FLASH, TURBO, etc."
            />
            {errors.desired_plan && <p className="text-red-500 text-xs mt-1">{errors.desired_plan}</p>}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Promo
            </label>
            <input
              type="text"
              value={formData.promo}
              onChange={(e) => setFormData({ ...formData, promo: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
              placeholder="Promo code (if any)"
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Referred By
            </label>
            <input
              type="text"
              value={formData.referred_by}
              onChange={(e) => setFormData({ ...formData, referred_by: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
              placeholder="Name of referrer (if any)"
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Government Valid ID
            </label>
            <input
              type="text"
              value={formData.government_valid_id}
              onChange={(e) => setFormData({ ...formData, government_valid_id: e.target.value })}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
              placeholder="Google Drive link or ID number"
            />
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
              }`}>Upload to Google Drive and paste the link here</p>
          </div>

          <div>
            <label className="flex items-start space-x-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.terms_and_conditions}
                onChange={(e) => setFormData({ ...formData, terms_and_conditions: e.target.checked })}
                className={`mt-1 h-4 w-4 rounded border text-orange-600 focus:ring-orange-500 ${errors.terms_and_conditions
                  ? 'border-red-500'
                  : isDarkMode
                    ? 'border-gray-600 bg-gray-700 focus:ring-offset-gray-800'
                    : 'border-gray-300 bg-white focus:ring-offset-white'
                  }`}
              />
              <div className="flex-1">
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  I agree to the Terms and Conditions<span className="text-red-500">*</span>
                </span>
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`}>
                  By checking this box, you confirm that you have read and agree to our terms and conditions.
                </p>
                {errors.terms_and_conditions && <p className="text-red-500 text-xs mt-1">{errors.terms_and_conditions}</p>}
              </div>
            </label>
          </div>

          <div className={`p-4 border rounded-lg ${isDarkMode
            ? 'bg-blue-900/20 border-blue-700/30'
            : 'bg-blue-50 border-blue-200'
            }`}>
            <p className={`text-sm ${isDarkMode ? 'text-blue-300' : 'text-blue-700'
              }`}>
              <strong>Note:</strong> Timestamp will be automatically recorded when the application is created.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddApplicationModal;
