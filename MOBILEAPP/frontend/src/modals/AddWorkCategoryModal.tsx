import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface WorkCategory {
  id: number;
  category: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  organization_id?: number | null;
  updated_by_user_id?: number;
}

interface AddWorkCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingWorkCategory?: WorkCategory | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const AddWorkCategoryModal: React.FC<AddWorkCategoryModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingWorkCategory,
}) => {
  const [formData, setFormData] = useState({ category: '' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: '',
  });
  const [modifiedDate, setModifiedDate] = useState<string>('');
  const [modifiedBy, setModifiedBy] = useState<string>('');

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
      let userEmail = 'Unknown User';
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || 'Unknown User';
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
      setModifiedBy(userEmail);
    };
    init();

    if (isOpen) {
      if (editingWorkCategory) {
        setFormData({ category: editingWorkCategory.category });
      } else {
        resetForm();
      }
      setModifiedDate(formatDateTime(new Date()));
    }
  }, [isOpen, editingWorkCategory]);

  const resetForm = () => {
    setFormData({ category: '' });
    setErrors({});
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.category.trim()) {
      newErrors.category = 'Work category name is required';
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
        message: 'Category designation is required.',
      });
      return;
    }

    setLoading(true);

    try {
      const authData = await AsyncStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;
      const currentUserEmail = currentUser?.email || currentUser?.email_address || 'system';

      const payload = {
        category: formData.category.trim(),
        email_address: currentUserEmail,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
      };

      const response = editingWorkCategory
        ? await apiClient.put(`/work-categories/${editingWorkCategory.id}`, payload)
        : await apiClient.post('/work-categories', payload);

      const data = response.data;

      if (data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Execution Success',
          message: data.message || `Work category ${editingWorkCategory ? 'updated' : 'added'} successfully`,
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
          title: 'Request Denied',
          message: data.message || `Failed to ${editingWorkCategory ? 'update' : 'add'} category`,
        });
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      const data = error?.response?.data;
      if (data?.errors) {
        const errorMessages = Object.values(data.errors).flat().join('\n');
        setModal({ isOpen: true, type: 'error', title: 'Integrity Error', message: errorMessages });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'System Interruption',
          message: data?.message || `External fault detected: ${error.message}`,
        });
      }
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
      title={editingWorkCategory ? 'Edit Work Category' : 'Add Work Category'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSubmit, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <AddWorkCategoryContent
        formData={formData}
        setFormData={setFormData}
        errors={errors}
        modifiedDate={modifiedDate}
        modifiedBy={modifiedBy}
      />
    </ModalUITemplate>
  );
};

const AddWorkCategoryContent: React.FC<{
  formData: { category: string };
  setFormData: (data: any) => void;
  errors: Record<string, string>;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);

  const labelColor = isDarkMode ? '#d1d5db' : '#1f2937';
  const readOnlyLabelColor = isDarkMode ? '#6b7280' : '#9ca3af';
  const inputBorder = errors.category
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
    <View style={{ gap: 24 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
          Category Name<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <TextInput
          value={formData.category}
          onChangeText={(text) => setFormData({ ...formData, category: text })}
          placeholder="Enter category name"
          placeholderTextColor="#9ca3af"
          autoFocus
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            width: '100%',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderRadius: 6,
            borderColor: inputBorder,
            color: isDarkMode ? '#ffffff' : '#000000',
          }}
        />
        {!!errors.category && <Text style={{ color: '#ef4444', fontSize: 12 }}>{errors.category}</Text>}
      </View>

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified Date
          </Text>
          <TextInput value={modifiedDate} editable={false} style={readOnlyStyle} />
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: readOnlyLabelColor }}>
            Modified By
          </Text>
          <TextInput value={modifiedBy} editable={false} style={readOnlyStyle} />
        </View>
      </View>
    </View>
  );
};

export default AddWorkCategoryModal;
