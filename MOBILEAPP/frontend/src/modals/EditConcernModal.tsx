import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Concern } from '../services/concernService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface ConcernFormData {
  name: string;
  userId?: number;
  modified_by?: string;
  organization_id?: number | null;
}

interface EditConcernModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (concernData: ConcernFormData) => void;
  concernItem: Concern | null;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const EditConcernModal: React.FC<EditConcernModalProps> = ({ isOpen, onClose, onSave, concernItem }) => {
  const [formData, setFormData] = useState<ConcernFormData>({ name: '' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
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
      let userEmail = '';
      let userId: number | undefined;
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.email_address || '';
          userId = userData.id || userData.user_id;
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
      setModifiedBy(userEmail);

      if (isOpen) {
        setFormData({ name: concernItem ? concernItem.concern_name : '', userId });
        setErrors({});
        setModifiedDate(formatDateTime(new Date()));
      }
    };
    init();
  }, [isOpen, concernItem]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'Concern name is required';
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

    if (!modifiedBy) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Authentication Required',
        message: 'Your user session has expired or is invalid. Please re-login to perform this action.',
        onConfirm: () => setModal((prev) => ({ ...prev, isOpen: false })),
      });
      return;
    }

    setLoading(true);

    try {
      const authData = await AsyncStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;

      const payload: ConcernFormData = {
        ...formData,
        modified_by: modifiedBy,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
      };

      await onSave(payload);
      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: `Concern ${concernItem ? 'updated' : 'added'} successfully`,
        onConfirm: () => {
          handleClose();
          setModal((prev) => ({ ...prev, isOpen: false }));
        },
      });
    } catch (error) {
      console.error('Error submitting form:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to ${concernItem ? 'update' : 'add'} concern: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({ name: '' });
    setErrors({});
    onClose();
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={handleClose}
      title={concernItem ? 'Edit Concern' : 'Add Concern'}
      loading={loading}
      primaryAction={{ label: 'Save', onClick: handleSubmit, disabled: loading }}
      secondaryActionLabel="Cancel"
      alertModal={{
        ...modal,
        onConfirm: modal.onConfirm || (() => setModal({ ...modal, isOpen: false })),
        onCancel: modal.onCancel || (() => setModal({ ...modal, isOpen: false })),
      }}
    >
      <EditConcernContent
        formData={formData}
        setFormData={setFormData}
        errors={errors}
        modifiedDate={modifiedDate}
        modifiedBy={modifiedBy}
      />
    </ModalUITemplate>
  );
};

const EditConcernContent: React.FC<{
  formData: ConcernFormData;
  setFormData: (data: ConcernFormData) => void;
  errors: Record<string, string>;
  modifiedDate: string;
  modifiedBy: string;
}> = ({ formData, setFormData, errors, modifiedDate, modifiedBy }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);

  const labelColor = isDarkMode ? '#d1d5db' : '#1f2937';
  const readOnlyLabelColor = isDarkMode ? '#6b7280' : '#9ca3af';
  const inputBorder = errors.name
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
          Concern Name<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <TextInput
          value={formData.name}
          onChangeText={(text) => setFormData({ ...formData, name: text })}
          placeholder="Enter concern name"
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
        {!!errors.name && <Text style={{ color: '#ef4444', fontSize: 12 }}>{errors.name}</Text>}
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

export default EditConcernModal;
