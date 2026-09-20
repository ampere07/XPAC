import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../config/api';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface RouterModel {
  SN: string;
  Model?: string;
  brand?: string;
  description?: string;
  is_active?: boolean;
  modified_date?: string;
  modified_by?: string;
  created_at?: string;
  updated_at?: string;
}

interface AddRouterModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingRouter?: RouterModel | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const AddRouterModelModal: React.FC<AddRouterModelModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingRouter,
}) => {
  const [formData, setFormData] = useState({
    brand: '',
    model: '',
    description: '',
    modifiedDate: '',
    modifiedBy: '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
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
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strHours = String(hours).padStart(2, '0');
    return `${month}/${day}/${year} ${strHours}:${minutes} ${ampm}`;
  };

  useEffect(() => {
    const init = async () => {
      if (!isOpen) return;
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

      setFormData({
        brand: editingRouter?.brand || '',
        model: editingRouter?.Model || '',
        description: editingRouter?.description || '',
        modifiedDate: formatDateTime(new Date()),
        modifiedBy: userEmail,
      });
      setErrors({});
    };
    init();
  }, [isOpen, editingRouter]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.brand.trim()) newErrors.brand = 'Brand is required';
    if (!formData.model.trim()) newErrors.model = 'Model is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      setModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Brand and Model are required.',
      });
      return;
    }

    setLoading(true);

    try {
      const payload = {
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        description: formData.description.trim(),
      };

      const response = editingRouter
        ? await apiClient.put(`/router-models/${editingRouter.SN}`, payload)
        : await apiClient.post('/router-models', payload);

      const data = response.data;

      if (data.success) {
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: data.message || `Router model ${editingRouter ? 'updated' : 'added'} successfully`,
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
          message: data.message || `Failed to ${editingRouter ? 'update' : 'add'} router model`,
        });
      }
    } catch (error: any) {
      console.error('Error submitting form:', error);
      const data = error?.response?.data;
      if (data?.errors) {
        const errorMessages = Object.values(data.errors).flat().join('\n');
        setModal({ isOpen: true, type: 'error', title: 'Validation errors', message: errorMessages });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: data?.message || `Failed to ${editingRouter ? 'update' : 'add'} router model: ${error.message}`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ brand: '', model: '', description: '', modifiedDate: '', modifiedBy: '' });
    setErrors({});
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={editingRouter ? 'Edit Router Model' : 'Add Router Model'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSubmit, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <AddRouterModelContent formData={formData} setFormData={setFormData} errors={errors} />
    </ModalUITemplate>
  );
};

const FormField: React.FC<{
  label: string;
  required?: boolean;
  value: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  error?: string;
  multiline?: boolean;
  editable?: boolean;
}> = ({ label, required, value, onChangeText, placeholder, error, multiline, editable = true }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);

  const labelColor = isDarkMode ? '#d1d5db' : '#374151';
  const borderColor = error
    ? '#ef4444'
    : isFocused
      ? (colorPalette?.primary || '#7c3aed')
      : (isDarkMode ? '#374151' : '#d1d5db');

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
        {label}
        {required && <Text style={{ color: '#ef4444' }}> *</Text>}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        editable={editable}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        textAlignVertical={multiline ? 'top' : 'center'}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          width: '100%',
          minHeight: multiline ? 96 : undefined,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderRadius: 6,
          borderColor,
          opacity: editable ? 1 : 0.6,
          color: isDarkMode ? '#ffffff' : '#111827',
        }}
      />
      {!!error && <Text style={{ color: '#ef4444', fontSize: 12 }}>{error}</Text>}
    </View>
  );
};

const AddRouterModelContent: React.FC<{
  formData: { brand: string; model: string; description: string; modifiedDate: string; modifiedBy: string };
  setFormData: (data: any) => void;
  errors: Record<string, string>;
}> = ({ formData, setFormData, errors }) => {
  const { isDarkMode } = useModalTheme();

  return (
    <View style={{ gap: 24 }}>
      <FormField
        label="Brand"
        required
        value={formData.brand}
        onChangeText={(t) => setFormData({ ...formData, brand: t })}
        placeholder="Enter router brand"
        error={errors.brand}
      />
      <FormField
        label="Model"
        required
        value={formData.model}
        onChangeText={(t) => setFormData({ ...formData, model: t })}
        placeholder="Enter router model"
        error={errors.model}
      />
      <FormField
        label="Description"
        value={formData.description}
        onChangeText={(t) => setFormData({ ...formData, description: t })}
        placeholder="Enter router description or specifications"
        multiline
      />
      <FormField label="Modified By" value={formData.modifiedBy} editable={false} />
      <FormField label="Modified Date" value={formData.modifiedDate} editable={false} />

      <View
        style={{
          padding: 16,
          borderWidth: 1,
          borderRadius: 8,
          backgroundColor: isDarkMode ? 'rgba(30,58,138,0.2)' : '#eff6ff',
          borderColor: isDarkMode ? 'rgba(29,78,216,0.3)' : '#bfdbfe',
        }}
      >
        <Text style={{ fontSize: 13, color: isDarkMode ? '#93c5fd' : '#1d4ed8' }}>
          <Text style={{ fontWeight: '700' }}>Note: </Text>
          Serial Number (SN) will be automatically generated based on brand and model. Modified date and user
          information will be set automatically when the router model is created or updated.
        </Text>
      </View>
    </View>
  );
};

export default AddRouterModelModal;
