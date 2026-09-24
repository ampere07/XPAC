import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface Promo {
  id: number;
  name: string;
  promo_name?: string;
  description?: string;
  status?: string;
  organization_id?: number | null;
  created_at?: string;
  updated_at?: string;
  creator_email?: string;
  updater_email?: string;
}

interface PromoFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingPromo: Promo | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const PromoFormModal: React.FC<PromoFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingPromo
}) => {
  const [formData, setFormData] = useState({
    name: '',
    status: ''
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  useEffect(() => {
    if (isOpen) {
      if (editingPromo) {
        setFormData({
          name: editingPromo.name,
          status: editingPromo.status || ''
        });
        setModifiedDate(formatDateTime(new Date(editingPromo.updated_at || editingPromo.created_at || new Date())));
        setModifiedBy(editingPromo.updater_email || editingPromo.creator_email || 'N/A');
      } else {
        setFormData({
          name: '',
          status: ''
        });
        setErrors({});
        setModifiedDate(formatDateTime(new Date()));
        const authData = localStorage.getItem('authData');
        if (authData) {
          try {
            const userData = JSON.parse(authData);
            setModifiedBy(userData.email || userData.email_address || 'Unknown User');
          } catch (e) {
            setModifiedBy('Unknown User');
          }
        }
      }
    }
  }, [isOpen, editingPromo]);

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

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Promo name is required';
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
        message: 'Please fill in all required fields.'
      });
      return;
    }

    setLoading(true);

    try {
      const authData = localStorage.getItem('authData');
      let userEmail = '';
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || '';
        } catch (e) {
          console.error('Error parsing authData:', e);
        }
      }

      const payload = {
        name: formData.name.trim(),
        status: formData.status.trim(),
        email_address: userEmail
      };

      const url = editingPromo
        ? `${API_BASE_URL}/promos/${editingPromo.id}`
        : `${API_BASE_URL}/promos`;

      const method = editingPromo ? 'PUT' : 'POST';

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
          message: data.message || `Promo ${editingPromo ? 'updated' : 'added'} successfully`,
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
            message: data.message || `Failed to ${editingPromo ? 'update' : 'add'} promo`
          });
        }
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to ${editingPromo ? 'update' : 'add'} promo: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      status: ''
    });
    setErrors({});
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingPromo ? 'Edit Promo' : 'Add Promo'}
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
        <PromoFormContent
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

const PromoFormContent: React.FC<{
  formData: any;
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();

  const inputClasses = `w-full px-3 py-2 border rounded focus:outline-none transition-all duration-200 bg-transparent ${isDarkMode ? 'border-gray-700 text-white focus:border-blue-500' : 'border-gray-300 text-black focus:border-blue-500'
    }`;

  const readOnlyClasses = `w-full px-3 py-2 border rounded bg-transparent opacity-60 cursor-not-allowed ${isDarkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'
    }`;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Promo Name<span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className={`${inputClasses} ${errors.name ? 'border-red-500' : ''}`}
          placeholder="Enter promo name"
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
          autoFocus
        />
        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
      </div>

      <div className="space-y-2">
        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Status
        </label>
        <select
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          className={inputClasses}
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
        >
          <option value="">Select Status</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className={`block text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
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
          <label className={`block text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
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

export default PromoFormModal;
