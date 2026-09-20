import React, { useState, useEffect } from 'react';
import { Plus, Minus } from 'lucide-react';
import { API_BASE_URL, authFetch } from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface Plan {
  id: number;
  name: string;
  description?: string;
  price: number;
  is_active?: boolean;
  organization_id?: number | null;
  modified_date?: string;
  modified_by?: string;
  created_at?: string;
  updated_at?: string;
}

interface AddPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingPlan?: Plan | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const AddPlanModal: React.FC<AddPlanModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingPlan
}) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: 0
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  useEffect(() => {
    if (isOpen) {
      if (editingPlan) {
        setFormData({
          name: editingPlan.name,
          description: editingPlan.description || '',
          price: editingPlan.price || 0
        });
        setModifiedDate(formatDateTime(new Date(editingPlan.modified_date || editingPlan.updated_at || new Date())));
        setModifiedBy(editingPlan.modified_by || 'N/A');
      } else {
        setFormData({
          name: '',
          description: '',
          price: 0
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
  }, [isOpen, editingPlan]);

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
      newErrors.name = 'Plan name is required';
    }
    if (formData.price < 0) {
      newErrors.price = 'Price cannot be negative';
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
      const currentUser = authData ? JSON.parse(authData) : null;
      const userEmail = currentUser?.email || currentUser?.email_address || '';

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        price: formData.price,
        email_address: userEmail,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      const url = editingPlan
        ? `${API_BASE_URL}/plans/${editingPlan.id}`
        : `${API_BASE_URL}/plans`;

      const method = editingPlan ? 'PUT' : 'POST';

      const response = await authFetch(url, {
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
          message: data.message || `Plan ${editingPlan ? 'updated' : 'added'} successfully`,
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
            message: data.message || `Failed to ${editingPlan ? 'update' : 'add'} plan`
          });
        }
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to ${editingPlan ? 'update' : 'add'} plan: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      description: '',
      price: 0
    });
    setErrors({});
    onClose();
  };

  const incrementPrice = () => {
    setFormData({ ...formData, price: formData.price + 1 });
  };

  const decrementPrice = () => {
    if (formData.price > 0) {
      setFormData({ ...formData, price: formData.price - 1 });
    }
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingPlan ? 'Edit Plan' : 'Add Plan'}
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
        <PlanFormContent
          formData={formData}
          setFormData={setFormData}
          errors={errors}
          incrementPrice={incrementPrice}
          decrementPrice={decrementPrice}
          modifiedDate={modifiedDate}
          modifiedBy={modifiedBy}
        />
      </div>
    </ModalUITemplate>
  );
};

const PlanFormContent: React.FC<{
  formData: any;
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  incrementPrice: () => void;
  decrementPrice: () => void;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, incrementPrice, decrementPrice, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();

  const inputClasses = `w-full px-3 py-2 border rounded focus:outline-none transition-all duration-200 bg-transparent ${isDarkMode ? 'border-gray-700 text-white focus:border-blue-500' : 'border-gray-300 text-black focus:border-blue-500'
    }`;

  const readOnlyClasses = `w-full px-3 py-2 border rounded bg-transparent opacity-60 cursor-not-allowed ${isDarkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'
    }`;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Plan Name<span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className={`${inputClasses} ${errors.name ? 'border-red-500' : ''}`}
          placeholder="Enter plan name"
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
          Description
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={3}
          className={`${inputClasses} resize-none`}
          placeholder="Enter plan description"
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
      </div>

      <div className="space-y-2">
        <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Price<span className="text-red-500">*</span>
        </label>
        <div className="flex items-stretch">
          <div className={`flex items-center px-4 border rounded-l-lg border-r-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-300'
            }`}>
            <span className={`font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>₱</span>
          </div>
          <input
            type="number"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) || 0 })}
            className={`flex-1 px-4 py-2 border focus:outline-none text-center border-l-0 border-r-0 ${errors.price ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
              } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
            step="0.01"
            min="0"
            onFocus={(e) => {
              if (colorPalette?.primary) {
                e.currentTarget.style.borderColor = colorPalette.primary;
              }
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = isDarkMode ? '#374151' : '#d1d5db';
            }}
          />
          <div className={`flex flex-col border-t border-b border-r rounded-r-lg overflow-hidden ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-100'}`}>
            <button
              type="button"
              onClick={incrementPrice}
              className={`flex-1 px-3 py-1 flex items-center justify-center border-b ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700 border-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200 border-gray-300'}`}
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={decrementPrice}
              className={`flex-1 px-3 py-1 flex items-center justify-center ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'}`}
            >
              <Minus className="h-3 w-3" />
            </button>
          </div>
        </div>
        {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
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

export default AddPlanModal;
