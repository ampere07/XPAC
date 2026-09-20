import React, { useState, useEffect } from 'react';
import { Organization } from '../types/api';
import { organizationService } from '../services/userService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface OrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (org: Organization) => void;
  organization?: Organization | null;
}

const OrganizationForm: React.FC<{
  formData: any;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  errors: Record<string, string>;
}> = ({ formData, handleInputChange, errors }) => {
  const { isDarkMode } = useModalTheme();

  const inputClass = (error?: string) => `w-full px-4 py-2.5 rounded-lg border transition-all duration-200 outline-none focus:ring-2 focus:ring-opacity-50 
    ${isDarkMode
      ? `bg-gray-800 text-white ${error ? 'border-red-500 focus:ring-red-500/20' : 'border-gray-700 focus:ring-blue-500/20'}`
      : `bg-white text-gray-900 ${error ? 'border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:ring-blue-500/20'}`
    }`;

  const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`;

  return (
    <div className="space-y-6">
      {errors.general && (
        <div className={`p-4 border rounded-xl text-sm font-medium ${isDarkMode ? 'bg-red-900/20 border-red-800/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {errors.general}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className={labelClass}>Organization Name</label>
          <input
            name="organization_name"
            value={formData.organization_name}
            onChange={handleInputChange}
            className={inputClass(errors.organization_name)}
            placeholder="Organization Name"
          />
          {errors.organization_name && <p className="text-red-500 text-xs mt-1.5 font-medium ml-1">{errors.organization_name}</p>}
        </div>

        <div>
          <label className={labelClass}>Address</label>
          <input
            name="address"
            value={formData.address}
            onChange={handleInputChange}
            className={inputClass()}
            placeholder="Address"
          />
        </div>

        <div>
          <label className={labelClass}>Contact Number</label>
          <input
            name="contact_number"
            value={formData.contact_number}
            onChange={handleInputChange}
            className={inputClass()}
            placeholder="Contact Number"
          />
        </div>

        <div>
          <label className={labelClass}>Email Address</label>
          <input
            name="email_address"
            type="email"
            value={formData.email_address}
            onChange={handleInputChange}
            className={inputClass(errors.email_address)}
            placeholder="Email Address"
          />
        </div>
      </div>
    </div>
  );
};

const OrganizationModal: React.FC<OrganizationModalProps> = ({ isOpen, onClose, onSave, organization }) => {
  const isEditMode = !!organization;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    organization_name: '',
    address: '',
    contact_number: '',
    email_address: '',
  });

  useEffect(() => {
    if (isOpen) {
      if (organization) {
        setFormData({
          organization_name: organization.organization_name || '',
          address: organization.address || '',
          contact_number: organization.contact_number || '',
          email_address: organization.email_address || '',
        });
      } else {
        setFormData({
          organization_name: '',
          address: '',
          contact_number: '',
          email_address: '',
        });
      }
      setErrors({});
    }
  }, [isOpen, organization]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.organization_name.trim()) newErrors.organization_name = 'Required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getUserEmail = () => {
    try {
      const authData = localStorage.getItem('authData');
      if (authData) {
        const user = JSON.parse(authData);
        return user.email || user.email_address || 'system';
      }
    } catch (e) {
      console.error('Error getting user email:', e);
    }
    return 'system';
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    setErrors({});
    
    try {
      const userEmail = getUserEmail();
      const payload: any = {
        organization_name: formData.organization_name,
        address: formData.address || null,
        contact_number: formData.contact_number || null,
        email_address: formData.email_address || null,
      };

      if (isEditMode) {
        payload.updated_by_user_id = userEmail;
      } else {
        payload.created_by_user_id = userEmail;
      }

      console.log('[OrganizationModal] Sending payload:', payload);

      let response: any;
      if (isEditMode && organization) {
        console.log('[OrganizationModal] Updating organization:', organization.id);
        response = await organizationService.updateOrganization(organization.id, payload);
      } else {
        console.log('[OrganizationModal] Creating new organization');
        response = await organizationService.createOrganization(payload);
      }

      console.log('[OrganizationModal] Server response:', response);

      if (response.success && response.data) {
        onSave(response.data);
        onClose();
      } else {
        const errorMsg = response.message || response.error || 'Action failed';
        console.error('[OrganizationModal] Action failed:', errorMsg);
        setErrors({ general: errorMsg });
      }
    } catch (err: any) {
      console.error('[OrganizationModal] Request error:', err);
      // Try to extract more info from the error if it's an Axios error
      const detailedError = err.response?.data?.message || err.response?.data?.error || err.message;
      setErrors({ general: detailedError || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Organization' : 'Save Organization'}
      loading={loading}
      maxWidth="max-w-md"
      primaryAction={{
        label: isEditMode ? 'Update' : 'Save',
        onClick: handleSave,
        disabled: loading
      }}
    >
      <OrganizationForm
        formData={formData}
        handleInputChange={handleInputChange}
        errors={errors}
      />
    </ModalUITemplate>
  );
};

export default OrganizationModal;
