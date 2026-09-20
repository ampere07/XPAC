import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  editingRemark,
}) => {
  const [formData, setFormData] = useState({ status_remarks: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: '',
  });

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

  useEffect(() => {
    const init = async () => {
      if (!isOpen) return;
      if (editingRemark) {
        setFormData({ status_remarks: editingRemark.status_remarks });
        setModifiedDate(formatDateTime(new Date(editingRemark.updated_at || editingRemark.created_at || new Date())));
        setModifiedBy(editingRemark.updated_by_user || editingRemark.created_by_user || 'N/A');
      } else {
        setFormData({ status_remarks: '' });
        setErrors({});
        setModifiedDate(formatDateTime(new Date()));
        try {
          const authData = await AsyncStorage.getItem('authData');
          if (authData) {
            const userData = JSON.parse(authData);
            setModifiedBy(userData.email || userData.email_address || 'Unknown User');
          }
        } catch (e) {
          setModifiedBy('Unknown User');
        }
      }
    };
    init();
  }, [isOpen, editingRemark]);

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
        message: 'Please fill in all required fields.',
      });
      return;
    }

    setLoading(true);

    try {
      let userEmail = '';
      const authData = await AsyncStorage.getItem('authData');
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
        email_address: userEmail,
      };

      const response: any = editingRemark
        ? await apiClient.put(`/status-remarks/${editingRemark.id}`, payload)
        : await apiClient.post('/status-remarks', payload);

      if (response.data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: response.data.message || `Status remark ${editingRemark ? 'updated' : 'added'} successfully`,
          onConfirm: () => {
            onSave();
            handleClose();
            setModal((prev) => ({ ...prev, isOpen: false }));
          },
        });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: response.data.message || `Failed to ${editingRemark ? 'update' : 'add'} status remark`,
        });
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      if (error.response?.data?.errors) {
        const validationMsgs = Object.values(error.response.data.errors).flat().join('\n');
        setModal({ isOpen: true, type: 'error', title: 'Validation Errors', message: validationMsgs });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: `Failed to ${editingRemark ? 'update' : 'add'} status remark: ${errorMessage}`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ status_remarks: '' });
    setErrors({});
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingRemark ? 'Edit Status Remark' : 'Add Status Remark'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSubmit, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <StatusRemarkFormContent
        formData={formData}
        setFormData={setFormData}
        errors={errors}
        modifiedDate={modifiedDate}
        modifiedBy={modifiedBy}
      />
    </ModalUITemplate>
  );
};

const StatusRemarkFormContent: React.FC<{
  formData: { status_remarks: string };
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);

  const labelColor = isDarkMode ? '#d1d5db' : '#374151';
  const readOnlyLabelColor = isDarkMode ? '#6b7280' : '#9ca3af';
  const inputBorder = errors.status_remarks
    ? '#ef4444'
    : isFocused
      ? (colorPalette?.primary || '#7c3aed')
      : (isDarkMode ? '#374151' : '#d1d5db');

  const readOnlyStyle = {
    width: '100%' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    opacity: 0.6,
    borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
          Status Remark<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <TextInput
          value={formData.status_remarks}
          onChangeText={(text) => setFormData({ ...formData, status_remarks: text })}
          placeholder="Enter status remark details"
          placeholderTextColor="#9ca3af"
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          autoFocus
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            width: '100%',
            minHeight: 120,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderRadius: 6,
            borderColor: inputBorder,
            color: isDarkMode ? '#ffffff' : '#000000',
          }}
        />
        {!!errors.status_remarks && <Text style={{ color: '#ef4444', fontSize: 12 }}>{errors.status_remarks}</Text>}
      </View>

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified Date
          </Text>
          <TextInput value={modifiedDate} editable={false} style={readOnlyStyle} />
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified By
          </Text>
          <TextInput value={modifiedBy} editable={false} style={readOnlyStyle} />
        </View>
      </View>
    </View>
  );
};

export default StatusRemarksFormModal;
