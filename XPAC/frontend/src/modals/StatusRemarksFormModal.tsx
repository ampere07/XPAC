import React, { useState, useEffect } from 'react';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';
import apiClient from '../config/api';

interface StatusRemark {
  id: number;
  status_remarks: string;
  created_at?: string;
  updated_at?: string;
  created_by_user?: string;
  updated_by_user?: string;
}

interface StatusRemarksFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingRemark: StatusRemark | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const StatusRemarksFormModal: React.FC<StatusRemarksFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingRemark
}) => {
  const [formData, setFormData] = useState({
    status_remarks: ''
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
      if (editingRemark) {
        setFormData({
          status_remarks: editingRemark.status_remarks
        });
        setModifiedDate(formatDateTime(new Date(editingRemark.updated_at || editingRemark.created_at || new Date())));
        setModifiedBy(editingRemark.updated_by_user || editingRemark.created_by_user || 'N/A');
      } else {
        setFormData({
          status_remarks: ''
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
  }, [isOpen, editingRemark]);

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
    if (!formData.status_remarks.trim()) {
      newErrors.status_remarks = 'Status remark is required';
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
        status_remarks: formData.status_remarks.trim(),
        email_address: userEmail
      };

      const url = editingRemark
        ? `/status-remarks/${editingRemark.id}`
        : `/status-remarks`;

      const method = editingRemark ? 'put' : 'post';

      const response: any = await apiClient[method](url, payload);

      if (response.data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: response.data.message || `Status remark ${editingRemark ? 'updated' : 'added'} successfully`,
          onConfirm: () => {
            onSave();
            handleClose();
            setModal(prev => ({ ...prev, isOpen: false }));
          }
        });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: response.data.message || `Failed to ${editingRemark ? 'update' : 'add'} status remark`
        });
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      if (error.response?.data?.errors) {
        const validationMsgs = Object.values(error.response.data.errors).flat().join('\n');
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Validation Errors',
          message: validationMsgs
        });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: `Failed to ${editingRemark ? 'update' : 'add'} status remark: ${errorMessage}`
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      status_remarks: ''
    });
    setErrors({});
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingRemark ? 'Edit Status Remark' : 'Add Status Remark'}
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
        <StatusRemarkFormContent
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

const StatusRemarkFormContent: React.FC<{
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
          Status Remark<span className="text-red-500">*</span>
        </label>
        <textarea
          value={formData.status_remarks}
          onChange={(e) => setFormData({ ...formData, status_remarks: e.target.value })}
          rows={5}
          className={`${inputClasses} resize-none ${errors.status_remarks ? 'border-red-500' : ''}`}
          placeholder="Enter status remark details"
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
        {errors.status_remarks && <p className="text-red-500 text-xs mt-1">{errors.status_remarks}</p>}
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

export default StatusRemarksFormModal;
