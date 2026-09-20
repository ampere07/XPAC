import React, { useState, useEffect } from 'react';
import { Technician } from '../types/api';
import { technicianService } from '../services/technicianService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface TechnicianModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tech: Technician) => void;
  technician?: Technician | null;
}

const TechnicianForm: React.FC<{
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
          <label className={labelClass}>First Name</label>
          <input
            name="first_name"
            value={formData.first_name}
            onChange={handleInputChange}
            className={inputClass(errors.first_name)}
            placeholder="First Name"
          />
          {errors.first_name && <p className="text-red-500 text-xs mt-1.5 font-medium ml-1">{errors.first_name}</p>}
        </div>

        <div>
          <label className={labelClass}>Middle Initial</label>
          <input
            name="middle_initial"
            value={formData.middle_initial}
            onChange={handleInputChange}
            maxLength={1}
            className={inputClass()}
            placeholder="M"
          />
        </div>

        <div>
          <label className={labelClass}>Last Name</label>
          <input
            name="last_name"
            value={formData.last_name}
            onChange={handleInputChange}
            className={inputClass(errors.last_name)}
            placeholder="Last Name"
          />
          {errors.last_name && <p className="text-red-500 text-xs mt-1.5 font-medium ml-1">{errors.last_name}</p>}
        </div>
      </div>
    </div>
  );
};

const TechnicianModal: React.FC<TechnicianModalProps> = ({ isOpen, onClose, onSave, technician }) => {
  const isEditMode = !!technician;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    first_name: '',
    middle_initial: '',
    last_name: '',
  });

  useEffect(() => {
    if (isOpen) {
      if (technician) {
        setFormData({
          first_name: technician.first_name || '',
          middle_initial: technician.middle_initial || '',
          last_name: technician.last_name || '',
        });
      } else {
        setFormData({
          first_name: '',
          middle_initial: '',
          last_name: '',
        });
      }
      setErrors({});
    }
  }, [isOpen, technician]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.first_name.trim()) newErrors.first_name = 'Required';
    if (!formData.last_name.trim()) newErrors.last_name = 'Required';

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
    try {
      const userEmail = getUserEmail();
      const payload = {
        ...formData,
        updated_by: userEmail
      };

      let response: any;
      if (isEditMode && technician) {
        response = await technicianService.updateTechnician(technician.id, payload);
      } else {
        response = await technicianService.createTechnician(payload);
      }

      if (response.success && response.data) {
        onSave(response.data);
        onClose();
      } else {
        setErrors({ general: response.message || 'Action failed' });
      }
    } catch (err: any) {
      setErrors({ general: err.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit' : 'Save'}
      loading={loading}
      maxWidth="max-w-md"
      primaryAction={{
        label: isEditMode ? 'Update' : 'Save',
        onClick: handleSave,
        disabled: loading
      }}
    >
      <TechnicianForm
        formData={formData}
        handleInputChange={handleInputChange}
        errors={errors}
      />
    </ModalUITemplate>
  );
};

export default TechnicianModal;
