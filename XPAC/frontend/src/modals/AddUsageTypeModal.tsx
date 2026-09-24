import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface AddUsageTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingUsageType?: UsageType | null;
}

interface UsageType {
  id: number;
  usage_name: string;
  created_at?: string;
  updated_at?: string;
  organization_id?: number | null;
  created_by_user_id?: number;
  updated_by_user_id?: number;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const AddUsageTypeModal: React.FC<AddUsageTypeModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingUsageType
}) => {
  const [formData, setFormData] = useState({
    usage_name: ''
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');

  useEffect(() => {
    const authData = localStorage.getItem('authData');
    let userEmail = 'Unknown User';

    if (authData) {
      try {
        const userData = JSON.parse(authData);
        userEmail = userData.email || userData.email_address || 'Unknown User';
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }

    setModifiedBy(userEmail);

    if (isOpen) {
      if (editingUsageType) {
        setFormData({
          usage_name: editingUsageType.usage_name
        });
      } else {
        resetForm();
      }
      
      const now = new Date();
      setModifiedDate(formatDateTime(now));
    }
  }, [isOpen, editingUsageType]);

  const formatDateTime = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';

    hours = hours % 12;
    hours = hours ? hours : 12;
    const strHours = String(hours).padStart(2, '0');

    return `${month}/${day}/${year} ${strHours}:${minutes}:${seconds} ${ampm}`;
  };

  const resetForm = () => {
    setFormData({
      usage_name: ''
    });
    setErrors({});
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.usage_name.trim()) {
      newErrors.usage_name = 'Usage type name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      setModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Usage type name is required.'
      });
      return;
    }

    setLoading(true);

    try {
      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;
      const currentUserEmail = currentUser?.email || currentUser?.email_address || 'system';

      const payload = {
        usage_name: formData.usage_name.trim(),
        email_address: currentUserEmail,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      const url = editingUsageType
        ? `${API_BASE_URL}/usage-types/${editingUsageType.id}`
        : `${API_BASE_URL}/usage-types`;

      const method = editingUsageType ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: data.message || `Usage type ${editingUsageType ? 'updated' : 'added'} successfully`,
          onConfirm: () => {
            onSave();
            handleClose();
            setModal(prev => ({ ...prev, isOpen: false }));
          }
        });
      } else {
        if (data.errors) {
          const errorMessages = Object.values(data.errors).flat().join('\n');
          setModal({
            isOpen: true,
            type: 'error',
            title: 'Validation Errors',
            message: errorMessages
          });
        } else {
          setModal({
            isOpen: true,
            type: 'error',
            title: 'Error',
            message: data.message || `Failed to ${editingUsageType ? 'update' : 'add'} usage type`
          });
        }
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Critical Error',
        message: `Failed to process request: ${error.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingUsageType ? 'Edit Usage Context' : 'Add Usage Type'}
      loading={loading}
      primaryAction={{
        label: 'Save',
        onClick: handleSubmit,
        disabled: loading
      }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false }))
      }}
    >
      <div className="space-y-6">
        <AddUsageTypeContent
          formData={formData}
          setFormData={setFormData}
          errors={errors}
          modifiedDate={modifiedDate}
          modifiedBy={modifiedBy}
        />
      </div>
    </ModalUITemplate>
  );
};

const AddUsageTypeContent: React.FC<{
  formData: { usage_name: string };
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();

  const readOnlyClasses = `w-full px-3 py-2 border rounded bg-transparent opacity-60 cursor-not-allowed ${isDarkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'
    }`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}>
          Usage Type Name<span className="text-red-500 ml-1">*</span>
        </label>
        <input
          type="text"
          value={formData.usage_name}
          onChange={(e) => {
            setFormData({ ...formData, usage_name: e.target.value });
          }}
          className={`w-full px-3 py-2 border rounded focus:outline-none transition-all duration-200 bg-transparent ${isDarkMode ? 'border-gray-700 text-white' : 'border-gray-300 text-black'
            } ${errors.usage_name ? 'border-red-500' : ''}`}
          placeholder="Enter usage type name"
          autoFocus
          onFocus={(e) => {
            if (colorPalette?.primary) {
              e.currentTarget.style.borderColor = colorPalette.primary;
              e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}20`;
            }
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
        {errors.usage_name && <p className="text-red-500 text-xs mt-1">{errors.usage_name}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className={`block text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Modified Date
          </label>
          <input
            type="text"
            value={modifiedDate}
            readOnly
            className={readOnlyClasses}
          />
        </div>
        <div className="space-y-2">
          <label className={`block text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Modified By
          </label>
          <input
            type="text"
            value={modifiedBy}
            readOnly
            className={readOnlyClasses}
          />
        </div>
      </div>
    </div>
  );
};

export default AddUsageTypeModal;

