import React, { useState, useEffect } from 'react';
import { X, Loader2, Eye, EyeOff } from 'lucide-react';
import { User, CreateUserRequest, UpdateUserRequest, Role, Organization, Agent } from '../types/api';
import { userService, roleService, organizationService } from '../services/userService';
import { agentService } from '../services/agentService';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  user?: User | null; // If provided, we are in Edit mode
  agentOnly?: boolean; // If true, role is locked to Agent
}

/**
 * Starting values pre-filled on the Agent fields when creating a new user.
 *
 * The fields stay required — this only saves the agreed standard terms being
 * typed out for every new Agent, and they can still be overwritten before the
 * account is created. An existing user is never touched by these: editing
 * always shows that user's own stored values.
 *
 * Quota is a COUNT of completed referrals that earns one incentive; Commission
 * and Incentives are peso amounts. Change the agreed terms here.
 */
const AGENT_DEFAULTS = {
  commission: 100,        // ₱ per completed referral
  quota: 10,              // completed referrals per incentive batch
  incentives_value: 100,  // ₱ per completed batch
} as const;

/** A blank create form, carrying the Agent defaults above. */
const EMPTY_USER_FORM: CreateUserRequest = {
  first_name: '',
  middle_initial: '',
  last_name: '',
  username: '',
  email_address: '',
  contact_number: '',
  password: '',
  role_id: undefined,
  agent_id: undefined,
  organization_id: undefined,
  commission: AGENT_DEFAULTS.commission,
  quota: AGENT_DEFAULTS.quota,
  incentives_value: AGENT_DEFAULTS.incentives_value,
  remarks: '',
};

const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, user, agentOnly = false }) => {
  const isEditMode = !!user;
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingModal, setLoadingModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error';
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: '',
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  const [formData, setFormData] = useState<CreateUserRequest>({
    ...EMPTY_USER_FORM,
  });

  useEffect(() => {
    const theme = localStorage.getItem('theme');
    setIsDarkMode(theme === 'dark');

    const fetchPalette = async () => {
      const palette = await settingsColorPaletteService.getActive();
      setColorPalette(palette);
    };
    fetchPalette();

    const loadData = async () => {
      try {
        const [rolesRes, agentsRes, organizationsRes] = await Promise.all([
          roleService.getAllRoles(),
          agentService.getAllAgents(),
          organizationService.getAllOrganizations()
        ]);
        if (rolesRes.success) setRoles(rolesRes.data || []);
        if (agentsRes.success) setAgents(agentsRes.data || []);
        if (organizationsRes.success) setOrganizations(organizationsRes.data || []);
      } catch (err) {
        console.error('Failed to load modal data:', err);
      }
    };
    if (isOpen) loadData();
  }, [isOpen]);

  // Auto-set role_id to Agent role when agentOnly mode is active
  useEffect(() => {
    if (isOpen && agentOnly && roles.length > 0) {
      const agentRole = roles.find(r => r.role_name.toLowerCase() === 'agent');
      if (agentRole) {
        setFormData(prev => ({ ...prev, role_id: agentRole.id }));
      }
    }
  }, [isOpen, agentOnly, roles]);

  useEffect(() => {
    if (isOpen) {
      if (user) {
        setFormData({
          first_name: user.first_name || '',
          middle_initial: user.middle_initial || '',
          last_name: user.last_name || '',
          username: user.username || '',
          email_address: user.email_address || '',
          contact_number: user.contact_number || '',
          password: '',
          role_id: user.role_id ?? undefined,
          agent_id: user.agent_id ?? undefined,
          organization_id: user.organization_id ?? undefined,
          commission: user.agent_balance?.commission ?? undefined,
          quota: user.agent_balance?.quota ?? undefined,
          incentives_value: user.agent_balance?.incentives_value ?? undefined,
          remarks: user.agent_balance?.remarks ?? '',
        });
        setConfirmPassword('');
      } else {
        // Creating: start from a blank form carrying the agreed Agent defaults.
        setFormData({ ...EMPTY_USER_FORM });
        setConfirmPassword('');
      }
      setErrors({});
      setShowPassword(false);
      setShowConfirmPassword(false);
    }
  }, [isOpen, user]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'role_id' || name === 'agent_id' || name === 'organization_id') {
      const val = value ? parseInt(value) : undefined;
      setFormData(prev => ({ ...prev, [name]: val }));
    } else if (name === 'commission' || name === 'quota' || name === 'incentives_value') {
      const val = value === '' ? undefined : parseFloat(value);
      setFormData(prev => ({ ...prev, [name]: val }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }

    // Real-time password validation as requested
    if (name === 'password') {
      if (value && value.length < 8) {
        setErrors(prev => ({ ...prev, password: 'Min 8 chars' }));
      } else {
        setErrors(prev => ({ ...prev, password: '' }));
      }
    } else if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.first_name?.trim()) newErrors.first_name = 'Required';
    if (!formData.last_name?.trim()) newErrors.last_name = 'Required';
    if (!formData.username?.trim()) newErrors.username = 'Required';
    if (!formData.email_address?.trim()) newErrors.email_address = 'Required';
    
    if (!isEditMode) {
      if (!formData.password) newErrors.password = 'Required';
      else if (formData.password.length < 8) newErrors.password = 'Min 8 chars';
      if (formData.password !== confirmPassword) newErrors.confirmPassword = 'Mismatch';
    } else if (formData.password && formData.password.length < 8) {
      newErrors.password = 'Min 8 chars';
    }

    if (!formData.role_id) {
      newErrors.role_id = 'Required';
    }

    const isAgent = roles.find(r => r.id === formData.role_id)?.role_name.toLowerCase() === 'agent' || agentOnly;
    if (isAgent) {
      if (formData.commission === undefined || isNaN(formData.commission)) newErrors.commission = 'Required';
      if (formData.quota === undefined || isNaN(formData.quota)) newErrors.quota = 'Required';
      if (formData.incentives_value === undefined || isNaN(formData.incentives_value)) newErrors.incentives_value = 'Required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoadingModal({
      isOpen: true,
      type: 'loading',
      title: isEditMode ? 'Updating User' : 'Creating User',
      message: 'Please wait counter while we process the request...',
    });

    try {
      let response: any;
      if (isEditMode && user) {
        const updateData: UpdateUserRequest = {
          first_name: formData.first_name,
          middle_initial: formData.middle_initial,
          last_name: formData.last_name,
          username: formData.username,
          email_address: formData.email_address,
          contact_number: formData.contact_number,
          role_id: formData.role_id,
          agent_id: formData.agent_id,
          organization_id: formData.organization_id,
          commission: formData.commission,
          quota: formData.quota,
          incentives_value: formData.incentives_value,
          remarks: formData.remarks,
        };
        if (formData.password) updateData.password = formData.password;
        response = await userService.updateUser(user.id, updateData);
      } else {
        response = await userService.createUser({ ...formData, active: 1 });
      }

      if (response.success && response.data) {
        setLoadingModal({
          isOpen: true,
          type: 'success',
          title: 'Success!',
          message: isEditMode ? 'User profile has been updated successfully.' : 'New user has been created successfully.',
        });
        
        setTimeout(() => {
          onSave(response.data!);
          // Reset ready for the next user, defaults included.
          setFormData({ ...EMPTY_USER_FORM });
          setConfirmPassword('');
          setLoadingModal(prev => ({ ...prev, isOpen: false }));
          onClose();
        }, 1500);
      } else {
        setLoadingModal({
          isOpen: true,
          type: 'error',
          title: 'Action Failed',
          message: response.message || 'We could not complete the request.',
        });
      }
    } catch (err: any) {
      if (err.response && err.response.status === 422) {
        const backendErrors = err.response.data.errors;
        const newErrors: Record<string, string> = {};
        
        if (backendErrors) {
          Object.keys(backendErrors).forEach(key => {
            const msg = backendErrors[key][0];
            // Normalize "already taken" or "already exists" to "already existed" as requested
            if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')) {
              newErrors[key] = 'already existed';
            } else {
              newErrors[key] = msg;
            }
          });
        }
        
        setErrors(newErrors);
        setLoadingModal(prev => ({ ...prev, isOpen: false }));
      } else {
        setLoadingModal({
          isOpen: true,
          type: 'error',
          title: 'System Error',
          message: err.message || 'An unexpected error occurred.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const inputClass = `w-full px-3 py-2 border rounded focus:outline-none transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white focus:border-blue-500' : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'}`;
  const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-end z-[5000]">
      <div className={`h-full w-full max-w-xl flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          <h2 className="text-xl font-semibold">
            {isEditMode ? 'Edit User' : 'Add New User'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors dark:hover:bg-gray-800">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form autoComplete="off" className="flex-1 overflow-y-auto p-6 space-y-5">
          {errors.general && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded text-sm">
              {errors.general}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>First Name*</label>
              <input name="first_name" value={formData.first_name} onChange={handleInputChange} className={`${inputClass} ${errors.first_name ? 'border-red-500' : ''}`} placeholder="Enter first name" />
              {errors.first_name && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.first_name}</p>}
            </div>

            <div>
              <label className={labelClass}>Last Name*</label>
              <input name="last_name" value={formData.last_name} onChange={handleInputChange} className={`${inputClass} ${errors.last_name ? 'border-red-500' : ''}`} placeholder="Enter last name" />
              {errors.last_name && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.last_name}</p>}
            </div>

            <div>
              <label className={labelClass}>Middle Initial</label>
              <input name="middle_initial" value={formData.middle_initial} onChange={handleInputChange} maxLength={1} className={inputClass} placeholder="M (Optional)" />
            </div>

            <div>
              <label className={labelClass}>Username*</label>
              <input name="username" value={formData.username} onChange={handleInputChange} className={`${inputClass} ${errors.username ? 'border-red-500' : ''}`} placeholder="Enter username" />
              {errors.username && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.username}</p>}
            </div>

            <div className="col-span-2">
              <label className={labelClass}>Email Address*</label>
              <input type="email" name="email_address" value={formData.email_address} onChange={handleInputChange} className={`${inputClass} ${errors.email_address ? 'border-red-500' : ''}`} placeholder="example@email.com" />
              {errors.email_address && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.email_address}</p>}
            </div>

            <div>
              <label className={labelClass}>Contact Number</label>
              <input name="contact_number" value={formData.contact_number} onChange={handleInputChange} autoComplete="off" className={inputClass} placeholder="Enter contact number" />
            </div>

            {!agentOnly && (
              <div>
                <label className={labelClass}>Organization</label>
                <select name="organization_id" value={formData.organization_id || ''} onChange={handleInputChange} className={inputClass}>
                  <option value="">Select Organization</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.organization_name}
                    </option>
                  ))}
                </select>
              </div>
            )}


            <div className="col-span-2">
              <label className={labelClass}>Role*</label>
              {agentOnly ? (
                <input
                  value="Agent"
                  readOnly
                  className={`${inputClass} opacity-70 cursor-not-allowed`}
                  style={{ pointerEvents: 'none' }}
                />
              ) : (
                <select name="role_id" value={formData.role_id || ''} onChange={handleInputChange} className={`${inputClass} ${errors.role_id ? 'border-red-500' : ''}`}>
                  <option value="">Select Role</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.role_name}</option>)}
                </select>
              )}
              {errors.role_id && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.role_id}</p>}
            </div>

            {/* Dynamic Team and Agent fields for Agent role */}
            {(roles.find(r => r.id === formData.role_id)?.role_name.toLowerCase() === 'agent' || agentOnly) && (
              <>
                <div className="col-span-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <label className={labelClass}>Team</label>
                  <select name="agent_id" value={formData.agent_id || ''} onChange={handleInputChange} className={`${inputClass} ${errors.agent_id ? 'border-red-500' : ''}`}>
                    <option value="">Select Team</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.team_name}</option>)}
                  </select>
                  {errors.agent_id && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.agent_id}</p>}
                </div>

                <div className="col-span-1 animate-in fade-in slide-in-from-top-1 duration-200">
                  <label className={labelClass}>Commission*</label>
                  <input type="number" step="0.01" name="commission" value={formData.commission ?? ''} onChange={handleInputChange} className={`${inputClass} ${errors.commission ? 'border-red-500' : ''}`} placeholder="0.00" />
                  {errors.commission && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.commission}</p>}
                </div>

                <div className="col-span-1 animate-in fade-in slide-in-from-top-1 duration-200">
                  <label className={labelClass}>Quota*</label>
                  <input type="number" step="0.01" name="quota" value={formData.quota ?? ''} onChange={handleInputChange} className={`${inputClass} ${errors.quota ? 'border-red-500' : ''}`} placeholder="0.00" />
                  {errors.quota && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.quota}</p>}
                </div>

                <div className="col-span-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <label className={labelClass}>Incentives*</label>
                  <input type="number" step="0.01" name="incentives_value" value={formData.incentives_value ?? ''} onChange={handleInputChange} className={`${inputClass} ${errors.incentives_value ? 'border-red-500' : ''}`} placeholder="0.00" />
                  {errors.incentives_value && <p className="text-red-500 text-[10px] mt-1 font-medium">{errors.incentives_value}</p>}
                </div>

                <div className="col-span-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <label className={labelClass}>Remarks</label>
                  <textarea name="remarks" value={formData.remarks || ''} onChange={handleInputChange} className={inputClass} placeholder="Enter remarks" rows={3} />
                </div>
              </>
            )}

            <div className="col-span-2">
              <label className={labelClass}>{isEditMode ? 'New Password (Optional)' : 'Password*'}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  className={`${inputClass} ${errors.password ? 'border-red-500' : ''}`}
                  placeholder={isEditMode ? 'Leave blank to keep current' : 'At least 8 characters'}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-gray-500">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1 font-medium">{errors.password}</p>}
            </div>

            {!isEditMode && (
              <div className="col-span-2">
                <label className={labelClass}>Confirm Password*</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: '' }));
                    }}
                    className={`${inputClass} ${errors.confirmPassword ? 'border-red-500' : ''}`}
                    placeholder="Repeat password"
                  />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-2.5 text-gray-500">
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-red-500 text-xs mt-1 font-medium">{errors.confirmPassword}</p>}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className={`px-6 py-4 border-t flex items-center justify-end gap-3 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${isDarkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-50'}`}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            style={{ backgroundColor: colorPalette?.primary }}
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {isEditMode ? 'Update User' : 'Create User'}
          </button>
        </div>
      </div>

      <LoadingModalGlobal 
        isOpen={loadingModal.isOpen}
        type={loadingModal.type}
        title={loadingModal.title}
        message={loadingModal.message}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        onConfirm={() => setLoadingModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default UserModal;
